const test = require('node:test');
const assert = require('node:assert/strict');
const { getKitchenOrders, markKitchenOrderReady } = require('../lib/kitchen');

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
