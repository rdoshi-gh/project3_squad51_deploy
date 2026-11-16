const test = require('node:test');
const assert = require('node:assert/strict');
const { getKitchenOrders, markKitchenOrderReady } = require('../lib/kitchen');
const { createApp } = require('../application');

test('kitchen opens and marks orders ready without login while employee APIs remain protected', async t => {
    const db = { query: async sql => {
        if (sql.includes('UPDATE customer_orders')) return [{ order_id: 42, kitchen_status: 'ready' }];
        return [];
    } };
    const server = createApp({ db, env: {}, secret: 'public-kitchen-test-secret' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/kitchen`, { redirect: 'manual' });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /accessibility-toggle/);
    assert.doesNotMatch(html, /logout-button|Employee:/);
    const legacy = await fetch(`${base}/kitchen/login`, { redirect: 'manual' });
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/kitchen');
    assert.deepEqual(await (await fetch(`${base}/api/kitchen/orders`)).json(), { inProgress: [], ready: [] });
    const ready = await fetch(`${base}/api/kitchen/orders/42/ready`, { method: 'PATCH' });
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).kitchen_status, 'ready');
    assert.equal((await fetch(`${base}/api/manager/inventory`)).status, 401);
    assert.equal((await fetch(`${base}/api/orders`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/kitchen/orders/42/ready`, { method: 'PATCH', headers: { Origin: 'https://elsewhere.example' } })).status, 403);
});

test('kitchen retrieves in-progress/ready orders with their item quantities', async () => {
    const calls = [];
    const fake = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (sql.includes("WHERE kitchen_status = 'in_progress'")) {
                return [{ order_id: 101, kitchen_status: 'in_progress', order_timestamp: '2026-11-02T11:10' }];
            }
            if (sql.includes("WHERE kitchen_status = 'ready'")) {
                return [{ order_id: 100, kitchen_status: 'ready', order_timestamp: '2026-11-02T11:00' }];
            }
            if (sql.includes('FROM order_items')) {
                return [
                    { order_id: 101, name: 'Brown Sugar Milk Tea', category: 'Milk Tea', quantity: 2 },
                    { order_id: 100, name: 'Taro Milk Tea', category: 'Milk Tea', quantity: 1 }
                ];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
    const result = await getKitchenOrders(fake);
    assert.equal(result.inProgress.length, 1);
    assert.equal(result.ready.length, 1);
    assert.deepEqual(result.inProgress[0].items, [
        { name: 'Brown Sugar Milk Tea', category: 'Milk Tea', quantity: 2 }
    ]);
    assert.deepEqual(calls[2].params, [[101, 100]]);
});

test('marking ready updates only in-progress orders with a parameterized ID', async () => {
    const calls = [];
    const fake = {
        async query(sql, params) {
            calls.push({ sql, params });
            return [{ order_id: 42, kitchen_status: 'ready', ready_at: '2026-11-02T12:00' }];
        }
    };
    const result = await markKitchenOrderReady(fake, 42);
    assert.equal(result.kitchen_status, 'ready');
    assert.match(calls[0].sql, /WHERE order_id = \$1 AND kitchen_status = 'in_progress'/);
    assert.deepEqual(calls[0].params, [42]);
});

test('double mark-ready returns 409 and unknown orders return 404', async () => {
    for (const [exists, status] of [[true, 409], [false, 404]]) {
        const fake = { async query(sql) { return sql.includes('UPDATE') ? [] : exists ? [{ kitchen_status: 'ready' }] : []; } };
        await assert.rejects(() => markKitchenOrderReady(fake, 42), error => error.status === status);
    }
});
