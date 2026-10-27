const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');
const { getReport, getRange } = require('../lib/reports');
const { db: realDb } = require('../lib/db');
const { openFixture } = require('./helpers/fixture');

test('PostgreSQL parity: read-only team data and isolated write workflows', { skip: process.env.RUN_DB_TESTS !== '1' }, async t => {
    await t.test('every report runs against the existing schema without modifying team data', async () => {
        try {
            const range = await getRange(realDb);
            for (const type of ['daily', 'top', 'sales', 'inventory', 'restock', 'hourly', 'usage']) {
                const report = await getReport(realDb, type, range.start, range.last);
                assert.ok(Array.isArray(report.rows), `${type} returns rows`);
            }
        } finally { await realDb.close(); }
    });
    const fixture = await openFixture();
    t.after(() => fixture.close());
    const server = createApp({ db: fixture.db, secret: 'isolated-integration-test-secret' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = async (view, employeeId) => {
        const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view, employeeId }) });
        assert.equal(response.status, 200);
        return response.headers.get('set-cookie').split(';')[0];
    };
    const manager = await login('manager', 1), cashier = await login('cashier', 2);
    const request = async (url, method = 'GET', body, cookie = manager) => {
        const response = await fetch(`${base}${url}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() };
    };
    await t.test('role enforcement, cookie integrity, and cross-origin write protection', async () => {
        assert.equal((await request('/api/manager/inventory', 'GET', null, cashier)).status, 403);
        assert.equal((await request('/api/manager/inventory', 'GET', null, manager + 'x')).status, 401);
        assert.equal((await request('/api/session', 'POST', { view: 'manager', employeeId: 2 })).status, 403);
        const blocked = await fetch(`${base}/api/manager/reorders`, { method: 'POST', headers: { Cookie: manager, Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(blocked.status, 403);
    });
    await t.test('manager screens read dashboard, history, usage, and inventory review', async () => {
        for (const url of ['dashboard', 'orders?start=2026-10-01&end=2026-10-01', 'orders/1', 'inventory/1/review', 'menu/1/ingredients', 'reorders']) {
            const response = await request(`/api/manager/${url}`); assert.equal(response.status, 200, `${url}: ${JSON.stringify(response.data)}`);
        }
        const { data } = await request('/api/manager/orders?start=2026-10-01&end=2026-10-01');
        assert.equal(data.rows.length, 1); assert.equal(Number(data.totals.revenue), 11.5);
        assert.equal(data.rows[0].order_timestamp, '2026-10-01T23:59:59', 'timestamps preserve the database wall clock');
    });
    await t.test('employee/menu/inventory CRUD and recipes preserve relationships', async () => {
        const employee = await request('/api/manager/employees', 'POST', { name: 'Added Employee', role: 'Cashier' }); assert.equal(employee.status, 201);
        const eid = employee.data.employee_id;
        assert.equal((await request(`/api/manager/employees/${eid}`, 'PATCH', { name: 'Updated Employee', role: 'Manager' })).status, 200);
        assert.equal((await request(`/api/manager/employees/${eid}`, 'DELETE')).status, 200);
        assert.equal((await request('/api/manager/employees/2', 'DELETE')).status, 409);
        const inventory = await request('/api/manager/inventory', 'POST', { name: 'Temporary Ingredient', quantity: 10, unit: 'oz', reorder_level: 2 }); assert.equal(inventory.status, 201);
        const iid = inventory.data.inventory_item_id;
        const menu = await request('/api/manager/menu', 'POST', { name: 'Temporary Drink', category: 'Tea', price: 2.5 }); assert.equal(menu.status, 201);
        const mid = menu.data.menu_item_id;
        assert.equal((await request(`/api/manager/menu/${mid}`, 'PATCH', { name: 'Updated Drink', category: 'Tea', price: 3 })).status, 200);
        assert.equal((await request(`/api/manager/menu/${mid}/ingredients`, 'POST', { inventory_item_id: iid, quantity_required: 0.5 })).status, 201);
        assert.equal((await request(`/api/manager/menu/${mid}/ingredients/${iid}`, 'DELETE')).status, 200);
        assert.equal((await request(`/api/manager/menu/${mid}`, 'DELETE')).status, 200);
        assert.equal((await request(`/api/manager/inventory/${iid}`, 'DELETE')).status, 200);
        assert.equal((await request('/api/manager/menu/1', 'DELETE')).status, 409);
        assert.equal((await fixture.db.query('SELECT * FROM recipes WHERE menu_item_id=1')).length, 1, 'recipe deletion rolls back when menu history prevents deleting the item');
    });
    await t.test('count, reorder level, and reorder request writes', async () => {
        assert.equal((await request('/api/manager/inventory/1/count', 'PATCH', { value: 18 })).status, 200);
        assert.equal((await request('/api/manager/inventory/1/reorder-level', 'PATCH', { value: 8 })).status, 200);
        assert.equal((await request('/api/manager/reorders', 'POST', { inventory_item_id: 1, quantity_requested: 6 })).status, 201);
        assert.equal((await request('/api/manager/reorders', 'POST', { inventory_item_id: 1, quantity_requested: -1 })).status, 422);
        assert.equal((await request('/api/manager/inventory/1/count', 'PATCH', { value: '' })).status, 422);
    });
    await t.test('checkout records authoritative total and stock changes, with full rollback on failure', async () => {
        const lines = [{ menuItemId: 1, quantity: 2, toppings: [2], sweetness: 25, ice: 'Light', price: 0.01 }];
        const response = await request('/api/orders', 'POST', { lines }, cashier);
        assert.equal(response.status, 201); assert.equal(response.data.total, 11.5);
        assert.equal(Number((await fixture.db.query('SELECT quantity FROM inventory_items WHERE inventory_item_id=1'))[0].quantity), 16);
        const before = (await fixture.db.query('SELECT COUNT(*) AS count FROM customer_orders'))[0].count;
        const failure = await request('/api/orders', 'POST', { lines: [{ menuItemId: 1, quantity: 99 }] }, cashier);
        assert.equal(failure.status, 409);
        assert.equal((await fixture.db.query('SELECT COUNT(*) AS count FROM customer_orders'))[0].count, before);
        assert.equal((await request('/api/orders', 'POST', { lines }, manager)).status, 403);
        const [locks] = await fixture.db.query("SELECT COUNT(*) AS count FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'");
        assert.equal(Number(locks.count), 0, 'the preview never holds the production ID-allocation lock');
    });
});
