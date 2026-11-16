const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REWARDS, findReward, applyReward, pointsFor } = require('../lib/rewards');
const { saveOrder } = require('../lib/orders');
const { createApp } = require('../application');

const menu = [
    { menu_item_id: 1, name: 'Classic Milk Tea', category: 'Milk Tea', price: '10.00' },
    { menu_item_id: 2, name: 'Boba', category: 'Topping', price: '0.75' }
];

// Fake transaction client. `balance` is the customer's current points; the guarded UPDATE mimics Postgres.
function rewardsDb(balance, lifetimePoints = 0) {
    const calls = [];
    const client = { query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM menu_items')) return { rows: menu };
        if (sql.includes('FROM recipes')) return { rows: [] };
        if (sql.includes('FROM inventory_items')) return { rows: [] };
        if (sql.includes('UPDATE customers')) {
            const [spent, earned] = values;
            if (balance < spent) return { rows: [] };
            balance = balance - spent + earned;
            lifetimePoints += earned;
            return { rows: [{ points: balance, lifetime_points: lifetimePoints }] };
        }
        if (sql.includes('INSERT INTO customer_orders')) return { rows: [{ order_id: 10, order_timestamp: '2026-11-15T12:00:00' }] };
        return { rows: [] };
    } };
    return { calls, nextId: async () => 10, transaction: async fn => fn(client), query: async sql => (sql.includes('FROM customers') ? [{ points: balance }] : []) };
}

test('reward catalog is validated on the server', () => {
    assert.equal(findReward(undefined), null);
    assert.equal(findReward('save-5').points, 50);
    assert.throws(() => findReward('free-everything'), /valid reward/);
    assert.ok(REWARDS.every(reward => reward.points > 0 && reward.discountCents > 0));
    assert.equal(pointsFor(11.5), 11);
});

test('a reward cannot exceed the order subtotal', () => {
    assert.deepEqual(applyReward(1000, findReward('save-5')), { discountCents: 500, totalCents: 500 });
    assert.throws(() => applyReward(400, findReward('save-5')), /Add more/);
});

test('redeeming spends points, discounts the order, and earns on the amount paid', async () => {
    const db = rewardsDb(60);
    const result = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 2 }], 'Rev', { customerId: 3, rewardId: 'save-5' });
    assert.equal(result.subtotal, 20);
    assert.equal(result.discount, 5);
    assert.equal(result.total, 15);
    assert.equal(result.pointsRedeemed, 50);
    assert.equal(result.pointsEarned, 15);
    assert.equal(result.points, 25);
    const insert = db.calls.find(call => call.sql.includes('INSERT INTO customer_orders'));
    assert.equal(insert.values[2], 15, 'total_price stores what the customer paid');
});

test('redeeming without enough points fails before any order rows are written', async () => {
    const db = rewardsDb(10);
    await assert.rejects(saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3, rewardId: 'save-2' }), /need 25 points/);
    assert.equal(db.calls.some(call => call.sql.includes('INSERT')), false);
});

test('guests cannot redeem rewards', async () => {
    const db = rewardsDb(999);
    await assert.rejects(saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { rewardId: 'save-2' }), /Sign in/);
    assert.equal(db.calls.length, 0);
});

test('orders without a reward still earn points as before', async () => {
    const db = rewardsDb(5);
    const result = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3 });
    assert.equal(result.total, 10);
    assert.equal(result.pointsRedeemed, 0);
    assert.equal(result.pointsEarned, 10);
    assert.equal(result.points, 15);
    assert.equal(result.lifetimePoints, 10);
    assert.equal(result.discount, undefined);
});

test('Lifetime Points retain earnings across multiple reward redemptions', async () => {
    const db = rewardsDb(100, 150);
    const first = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3, rewardId: 'save-5' });
    assert.equal(first.points, 55);
    assert.equal(first.lifetimePoints, 155);
    const second = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3, rewardId: 'save-2' });
    assert.equal(second.points, 38);
    assert.equal(second.lifetimePoints, 163);
});

test('existing spendable balances are not counted as historical Lifetime Points', async () => {
    const db = rewardsDb(500);
    const result = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3 });
    assert.equal(result.points, 510);
    assert.equal(result.lifetimePoints, 10);
});

test('a rejected redemption does not add Lifetime Points', async () => {
    const db = rewardsDb(10, 100);
    await assert.rejects(saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3, rewardId: 'save-5' }), /need 50 points/);
    const result = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }], '', { customerId: 3 });
    assert.equal(result.lifetimePoints, 110);
    assert.equal(result.points, 20);
});

test('guest orders do not earn Lifetime Points', async () => {
    const db = rewardsDb(10);
    const result = await saveOrder(db, 6, [{ menuItemId: 1, quantity: 1 }]);
    assert.equal(result.lifetimePoints, undefined);
    assert.equal(db.calls.some(call => call.sql.includes('UPDATE customers')), false);
});

test('the rewards API lists the catalog and rejects guest redemption', async t => {
    const db = rewardsDb(0);
    const server = createApp({ db, secret: 'rewards-test-secret-that-is-long-enough' }).listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const catalog = await (await fetch(`${base}/api/kiosk/rewards`)).json();
    assert.equal(catalog.signedIn, false);
    assert.deepEqual(catalog.rewards.map(reward => reward.id), REWARDS.map(reward => reward.id));
    assert.equal(catalog.rewards[0].discount, 2);
    const order = await fetch(`${base}/api/kiosk/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: 'save-2', lines: [{ menuItemId: 1, quantity: 1 }] })
    });
    assert.equal(order.status, 401);
});

test('the kiosk checkout lets a signed-in customer pick a reward and sends it with the order', async t => {
    const { JSDOM } = require('jsdom');
    const ejs = require('ejs');
    const path = require('node:path');
    const { readFileSync } = require('node:fs');
    const html = await ejs.renderFile(path.join(__dirname, '../views/kiosk.ejs'), { customer: { firstName: 'Rev', points: 60 }, googleEnabled: true, signinError: '' });
    const dom = new JSDOM(html, { url: 'http://localhost/kiosk', runScripts: 'outside-only' });
    const w = dom.window, d = w.document, orders = [];
    t.after(() => w.close());
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    w.setInterval = () => 0;
    w.fetch = async (url, options) => {
        const json = data => ({ ok: true, json: async () => data });
        if (url === '/api/kiosk/menu') return json([{ menu_item_id: 1, name: 'Classic Milk Tea', category: 'Milk Tea', price: '4.00' }]);
        if (url === '/api/kiosk/rewards') return json({ signedIn: true, points: 60, rewards: REWARDS.map(r => ({ id: r.id, points: r.points, discount: r.discountCents / 100, label: r.label })) });
        if (url === '/api/kiosk/orders') { orders.push(JSON.parse(options.body)); return json({ order_id: 9, total: 3, subtotal: 8, discount: 5, pointsRedeemed: 50, pointsEarned: 3, points: 13 }); }
        return { ok: false, json: async () => ({}) };
    };
    w.eval(readFileSync(path.join(__dirname, '../public/static/kiosk.js'), 'utf8'));
    const until = async check => { for (let i = 0; i < 50 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check()); };
    await until(() => d.querySelector('.kiosk-add-drink'));
    d.getElementById('kiosk-customer-name').value = 'Rev';
    d.getElementById('kiosk-name-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    d.querySelector('.kiosk-add-drink').click();
    d.querySelector('#kiosk-dialog input[type=number]').value = '2';
    d.querySelector('#kiosk-dialog form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    d.getElementById('kiosk-review').click();
    const option = label => [...d.querySelectorAll('.kiosk-reward-option')].find(b => b.querySelector('strong').textContent === label);
    assert.equal(option('$12 off your order').disabled, true, 'not enough points');
    assert.equal(option('$2 off your order').disabled, false);
    option('$5 off your order').click();
    assert.equal(d.querySelector('.kiosk-grand-total strong').textContent, '$3.00');
    [...d.querySelectorAll('#kiosk-dialog button')].find(b => b.textContent === 'Place order').click();
    await until(() => orders.length === 1);
    assert.equal(orders[0].rewardId, 'save-5');
    await until(() => d.getElementById('kiosk-dialog').textContent.includes('redeemed 50 points'));
});
