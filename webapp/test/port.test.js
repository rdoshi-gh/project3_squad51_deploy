const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dateRange, number, text } = require('../lib/validation');
const { buildOrder, saveOrder } = require('../lib/orders');
const { getReport } = require('../lib/reports');
const { createApp } = require('../application');
const { Script } = require('node:vm');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

test('all browser entry points parse before being served', () => {
    const directory = path.join(__dirname, '../public/static');
    for (const file of readdirSync(directory).filter(file => file.endsWith('.js'))) {
        assert.doesNotThrow(() => new Script(readFileSync(path.join(directory, file), 'utf8'), { filename: file }));
    }
});

test('usage date shortcuts count inclusively from the latest sale across month/year boundaries', () => {
    const scope = { window: {}, document: { getElementById: () => null } };
    new Script(readFileSync(path.join(__dirname, '../public/static/common.js'), 'utf8')).runInNewContext(scope);
    const range = { first: '2025-01-01', last: '2026-01-03' };
    const preset = scope.window.POS.presetDates;
    assert.equal(preset(range, 7).start, '2025-12-28');
    assert.equal(preset(range, 30).start, '2025-12-05');
    assert.equal(preset(range, null).start, '2025-01-01');
    assert.equal(preset(range, null).end, '2026-01-03');
});

test('deployment entry point exports Express and static URLs map to public files', () => {
    assert.match(readFileSync(path.join(__dirname, '../index.js'), 'utf8'), /require\('express'\)/);
    const app = require('../index');
    assert.equal(typeof app, 'function');
    assert.equal(typeof app.handle, 'function');
    for (const asset of ['style.css', 'common.js', 'login.js', 'manager.js', 'cashier.js']) {
        assert.ok(readFileSync(path.join(__dirname, '../public/static', asset)).length);
    }
});

test('dates reject impossible/reversed dates and include the entire last day', () => {
    assert.deepEqual(dateRange('2026-10-01', '2026-10-01'), ['2026-10-01', '2026-10-01']);
    for (const dates of [['2026-02-30', '2026-03-01'], ['2026-10-02', '2026-10-01'], ['', '2026-10-01']]) {
        assert.throws(() => dateRange(...dates));
    }
});

test('numeric and text validation reject blank, non-finite, negative, and missing values', () => {
    for (const value of ['', null, true, Infinity, 'NaN', -1]) assert.throws(() => number(value, 'Quantity'));
    assert.equal(number('0', 'Quantity'), 0);
    assert.throws(() => text('   ', 'Name'));
});

const menu = [
    { menu_item_id: 1, name: 'Milk tea', category: 'Milk Tea', price: '5.25' },
    { menu_item_id: 2, name: 'Boba', category: 'Topping', price: '0.50' }
];

test('cashier totals use database prices and count toppings for each drink', () => {
    const result = buildOrder([{ menuItemId: 1, quantity: 2, sweetness: 50, ice: 'Light', toppings: [2] }], menu);
    assert.equal(result.totalCents, 1150);
    assert.equal(result.sold.get(1), 2);
    assert.equal(result.sold.get(2), 2);
    assert.throws(() => buildOrder([], menu));
    assert.throws(() => buildOrder([null], menu));
    assert.throws(() => buildOrder([{ menuItemId: 99, quantity: 1 }], menu));
    assert.throws(() => buildOrder([{ menuItemId: 1, quantity: -1 }], menu));
    assert.throws(() => buildOrder([{ menuItemId: 1, quantity: 1, toppings: [1] }], menu));
});

test('restock report excludes equal/above thresholds and preserves item units', async () => {
    const db = { query: async (sql) => {
        assert.match(sql, /quantity\s*<\s*reorder_level/);
        assert.doesNotMatch(sql, /quantity\s*<=/);
        return [{ name: 'Aloe', quantity: '9', unit: 'tubs', reorder_level: '10', amount_needed: '1' }];
    } };
    const report = await getReport(db, 'restock');
    assert.equal(report.rows[0][4], 1);
    assert.equal(report.rows[0][2], 'tubs');
    assert.equal(report.metrics[0].value, 1);
});

test('daily report computes the weighted average and uses exclusive next-day SQL boundary', async () => {
    const db = { query: async (sql, params) => {
        assert.match(sql, /<.*interval '1 day'/s);
        assert.deepEqual(params, ['2026-10-01', '2026-10-02']);
        return [{ day: '2026-10-01', orders: '2', revenue: '10' }, { day: '2026-10-02', orders: '1', revenue: '20' }];
    } };
    const report = await getReport(db, 'daily', '2026-10-01', '2026-10-02');
    assert.equal(report.metrics.find(metric => metric.label === 'Average order').value, '$10.00');
    assert.equal(report.chart.points.length, 2);
});

test('inventory reports ignore invalid historical date settings; unknown reports fail', async () => {
    const db = { query: async () => [] };
    assert.equal((await getReport(db, 'inventory', 'invalid', 'invalid')).rows.length, 0);
    assert.equal((await getReport(db, 'restock')).rows.length, 0);
    await assert.rejects(getReport(db, 'not-a-report'));
});

function orderDb(stock) {
    const calls = [];
    const client = { query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM menu_items')) return { rows: menu };
        if (sql.includes('FROM recipes')) return { rows: [{ inventory_item_id: 3, needed: '2' }] };
        if (sql.includes('FROM inventory_items')) return { rows: [{ inventory_item_id: 3, name: 'Milk', unit: 'gal', quantity: String(stock) }] };
        if (sql.includes('INSERT INTO customer_orders')) return { rows: [{ order_id: 10, order_timestamp: '2026-10-01T12:00:00' }] };
        return { rows: [] };
    } };
    return { calls, nextId: async () => 10, transaction: async (fn) => fn(client) };
}

test('orders reject insufficient stock before inserting any order rows', async () => {
    const db = orderDb(1);
    await assert.rejects(saveOrder(db, 1, [{ menuItemId: 1, quantity: 1 }]), /inventory/i);
    assert.equal(db.calls.some(call => call.sql.includes('INSERT')), false);
});

test('successful orders insert header/items and decrement inventory inside a transaction', async () => {
    const db = orderDb(5);
    const result = await saveOrder(db, 1, [{ menuItemId: 1, quantity: 2, toppings: [2] }]);
    assert.equal(result.total, 11.5);
    assert.ok(db.calls.some(call => call.sql.includes('FOR UPDATE')));
    assert.equal(db.calls.filter(call => call.sql.includes('INSERT INTO order_items')).length, 2);
    assert.ok(db.calls.some(call => call.sql.includes('UPDATE inventory_items')));
});

test('portal renders offline; manager APIs require a manager session', async (t) => {
    const app = createApp({ db: { query: async () => { throw new Error('offline'); } }, secret: 'test-only-secret-that-is-long-enough' });
    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.match(await (await fetch(base)).text(), /Popping POS.*Team 51/s);
    assert.equal((await fetch(`${base}/api/manager/inventory`)).status, 401);
    assert.equal((await fetch(`${base}/manager/login`)).status, 200);
});
