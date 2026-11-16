const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createApp } = require('../application');
const { sessions } = require('../lib/session');
const { getLeaderboard, updateDisplayName } = require('../lib/leaderboard');

async function start(t) {
    const calls = [];
    const secret = 'leaderboard-test-secret';
    const db = { query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('UPDATE customers')) return [{ display_name: values[0] }];
        if (sql.includes('WHERE c.customer_id')) return [{ customer_id: 12, display_name: null, points: 5, lifetime_points: 50, rank: '12' }];
        return [{ customer_id: 1, display_name: 'Tea fan', lifetime_points: 100, rank: '1' }];
    } };
    const server = createApp({ db, secret }).listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    let cookie;
    sessions(secret).writeSigned({ cookie: (name, value) => { cookie = `${name}=${value}`; } },
        'popping_customer', { customerId: 12, firstName: 'Private Google Name' }, 60000);
    return { base: `http://127.0.0.1:${server.address().port}`, cookie, calls };
}

test('the public leaderboard excludes private account fields and personal balances', async t => {
    const { base, calls } = await start(t);
    const response = await fetch(`${base}/api/kiosk/leaderboard`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { leaders: [{ displayName: 'Tea fan', lifetimePoints: 100, rank: 1, isYou: false }], me: null });
    assert.equal(calls.length, 1, 'guests do not trigger a personal account lookup');
    assert.deepEqual(calls[0].values, [10]);
});

test('the existing Google customer session identifies the personal rank', async t => {
    const { base, cookie, calls } = await start(t);
    const response = await fetch(`${base}/api/kiosk/leaderboard`, { headers: { Cookie: cookie } });
    const result = await response.json();
    assert.deepEqual(result.me, { displayName: 'Boba fan #12', hasDisplayName: false, points: 5, lifetimePoints: 50, rank: 12 });
    assert.deepEqual(calls.at(-1).values, [12]);
    assert.ok(!JSON.stringify(result).includes('Private Google Name'));
});

test('a customer can update only their own public display name', async t => {
    const { base, cookie, calls } = await start(t);
    const response = await fetch(`${base}/api/kiosk/leaderboard/profile`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ displayName: '  Boba Buddy  ', customerId: 1, lifetimePoints: 9999 })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { displayName: 'Boba Buddy' });
    assert.deepEqual(calls.at(-1).values, ['Boba Buddy', 12]);
});

test('guests and forged customer sessions cannot change display names', async t => {
    const { base, cookie, calls } = await start(t);
    for (const headers of [{}, { Cookie: `${cookie}forged` }]) {
        const response = await fetch(`${base}/api/kiosk/leaderboard/profile`, {
            method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: 'New name' })
        });
        assert.equal(response.status, 401);
    }
    assert.equal(calls.length, 0);
});

test('display names reject empty, oversized, and non-text input', async () => {
    const db = { query: async () => { assert.fail('invalid names must not reach the database'); } };
    for (const name of ['', '   ', 'x'.repeat(41), null, 42, ['name']]) {
        await assert.rejects(updateDisplayName(db, 1, name), /Display name must contain/);
    }
    await assert.rejects(updateDisplayName({ query: async () => [] }, 99, 'Tea fan'), error => error.status === 401);
});

test('an empty leaderboard and a deleted customer return no invented ranks', async () => {
    assert.deepEqual(await getLeaderboard({ query: async () => [] }, 99), { leaders: [], me: null });
});

test('PostgreSQL ranks ties and customers outside the Top 10 by Lifetime Points', { skip: process.env.RUN_DB_TESTS !== '1' }, async t => {
    const { openFixture } = require('./helpers/fixture');
    const fixture = await openFixture();
    t.after(() => fixture.close());
    const { db } = fixture;
    await db.query(`CREATE TEMP TABLE customers (customer_id INT PRIMARY KEY, email TEXT, points INT NOT NULL DEFAULT 0);
        INSERT INTO customers SELECT i, 'private-' || i || '@example.invalid', 500 FROM generate_series(1,13) i;`);
    for (const file of ['add_lifetime_points.sql', 'add_leaderboard_profiles.sql']) {
        await db.query(readFileSync(path.join(__dirname, '../../database', file), 'utf8'));
    }
    await db.query('UPDATE customers SET lifetime_points = (13 - customer_id) * 10');
    await db.query('UPDATE customers SET lifetime_points = 120 WHERE customer_id = 2');
    const result = await getLeaderboard(db, 12);
    assert.equal(result.leaders.length, 10);
    assert.deepEqual(result.leaders.slice(0, 3).map(row => row.rank), [1, 1, 3]);
    assert.equal(result.leaders[0].lifetimePoints, 120);
    assert.equal(result.me.rank, 12);
    assert.equal(result.me.points, 500, 'redeemable balance does not determine rank');
    assert.equal((await getLeaderboard(db, 1)).leaders[0].isYou, true);
    assert.equal((await getLeaderboard(db, 13)).me.rank, null);
    const name = "Boba'); DROP TABLE customers;--";
    await updateDisplayName(db, 1, name);
    assert.equal((await getLeaderboard(db, 1)).leaders[0].displayName, name);
    await db.query(readFileSync(path.join(__dirname, '../../database/add_leaderboard_profiles.sql'), 'utf8'));
    assert.equal((await getLeaderboard(db, 1)).me.displayName, name, 're-running the migration preserves display names');
    assert.ok(!JSON.stringify(result).includes('@example.invalid'));
});
