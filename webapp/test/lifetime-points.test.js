const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { saveOrder } = require('../lib/orders');

// Only connection-local temporary tables are changed; the fixture rolls back on close.
test('Lifetime Points migration, redemption, and order rollback in PostgreSQL', { skip: process.env.RUN_DB_TESTS !== '1' }, async t => {
    const { openFixture } = require('./helpers/fixture');
    const fixture = await openFixture();
    t.after(() => fixture.close());
    const { db } = fixture;
    await db.query(`CREATE TEMP TABLE customers (customer_id INT PRIMARY KEY, email TEXT, points INT NOT NULL DEFAULT 0);
        INSERT INTO customers VALUES (1, 'test@example.invalid', 60);
        ALTER TABLE order_items ADD COLUMN size TEXT, ADD COLUMN sweetness INT,
            ADD COLUMN ice TEXT, ADD COLUMN topping_ids INT[], ADD COLUMN unit_price NUMERIC(8,2);`);
    const migration = readFileSync(path.join(__dirname, '../../database/add_lifetime_points.sql'), 'utf8');
    await db.query(migration);
    assert.deepEqual(await db.query('SELECT points, lifetime_points FROM customers'), [{ points: 60, lifetime_points: 0 }]);
    await db.query('UPDATE customers SET lifetime_points = 100');
    await db.query(migration);
    assert.equal((await db.query('SELECT lifetime_points FROM customers'))[0].lifetime_points, 100, 're-running the migration preserves earned points');

    const result = await saveOrder(db, 2, [{ menuItemId: 1, quantity: 2 }], '', { customerId: 1, rewardId: 'save-5' });
    assert.equal(result.total, 5.5);
    assert.equal(result.points, 15);
    assert.equal(result.lifetimePoints, 105);
    const snapshot = await db.query('SELECT points, lifetime_points FROM customers');
    const orders = await db.query('SELECT COUNT(*)::int AS count FROM customer_orders');
    const failingDb = { ...db, transaction: work => db.transaction(client => work({ query: (sql, values) => {
        if (sql.includes('INSERT INTO customer_orders')) throw new Error('Simulated order failure');
        return client.query(sql, values);
    } })) };
    await assert.rejects(saveOrder(failingDb, 2, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 1 }), /Simulated order failure/);
    assert.deepEqual(await db.query('SELECT points, lifetime_points FROM customers'), snapshot, 'failed orders roll back both point counters');
    assert.deepEqual(await db.query('SELECT COUNT(*)::int AS count FROM customer_orders'), orders);
});
