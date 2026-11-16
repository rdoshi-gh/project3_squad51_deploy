const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { REWARDS } = require('../lib/rewards');
const catalog = REWARDS.map(row => ({ points: row.points, label: row.label }));

function loadScript(window, name) {
    window.eval(readFileSync(path.join(__dirname, `../public/static/${name}.js`), 'utf8'));
}

test('reward progress handles every tier boundary using redeemable points', t => {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    loadScript(dom.window, 'common');
    const render = dom.window.POS.rewardProgress;
    for (const [balance, remaining, target] of [[0, 25, 25], [24, 1, 25], [25, 25, 50], [49, 1, 50], [50, 50, 100], [99, 1, 100]]) {
        const widget = render(balance, catalog);
        assert.match(widget.textContent, new RegExp(`${remaining} more ${remaining === 1 ? 'point' : 'points'} until`));
        assert.equal(widget.querySelector('progress').max, target);
        assert.equal(widget.querySelector('progress').value, balance);
        assert.match(widget.querySelector('progress').getAttribute('aria-label'), /Progress toward/);
    }
    assert.match(render(25, catalog).textContent, /Points available for: \$2 off your order/);
    for (const balance of [100, 125]) {
        const widget = render(balance, catalog);
        assert.match(widget.textContent, /All reward tiers unlocked/);
        assert.match(widget.textContent, /Points available for: \$12 off your order/);
        assert.equal(widget.querySelector('progress').value, 100);
    }
    assert.equal(render(-1, catalog), null);
    assert.equal(render(NaN, catalog), null);
    assert.equal(render(10, []), null);
    assert.equal(render(10, undefined), null);
});

test('the signed-in kiosk welcome and ordering screens show the same reward progress', async t => {
    const html = await ejs.renderFile(path.join(__dirname, '../views/kiosk.ejs'), { customer: { firstName: 'Preview', points: 17 }, googleEnabled: true, signinError: '' });
    const dom = new JSDOM(html, { url: 'http://localhost/kiosk', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window, d = w.document;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    w.fetch = async url => ({ ok: true, json: async () => url === '/api/kiosk/rewards'
        ? { signedIn: true, points: 17, rewards: catalog }
        : url === '/api/kiosk/menu' ? [{ menu_item_id: 1, name: 'Tea', category: 'Tea', price: '5.00' }] : { available: false } });
    loadScript(w, 'common'); loadScript(w, 'kiosk');
    for (let i = 0; i < 50 && d.querySelector('[data-reward-progress]').hidden; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const hosts = [...d.querySelectorAll('[data-reward-progress]')];
    assert.equal(hosts.length, 2);
    assert.ok(hosts.every(host => !host.hidden && host.textContent.includes('8 more points until $2 off your order')));
    d.getElementById('kiosk-customer-name').value = 'Preview';
    d.getElementById('kiosk-name-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    assert.equal(d.getElementById('kiosk-order-screen').hidden, false);
    assert.match(d.getElementById('kiosk-order-screen').textContent, /8 more points until/);
});

test('a guest kiosk does not show a reward progress indicator', async t => {
    const html = await ejs.renderFile(path.join(__dirname, '../views/kiosk.ejs'), { customer: null, googleEnabled: true, signinError: '' });
    const dom = new JSDOM(html, { url: 'http://localhost/kiosk', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.fetch = async url => ({ ok: true, json: async () => url === '/api/kiosk/rewards'
        ? { signedIn: false, points: null, rewards: catalog } : url === '/api/kiosk/menu' ? [] : { available: false } });
    loadScript(dom.window, 'common'); loadScript(dom.window, 'kiosk');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.window.document.querySelector('.reward-progress'), null);
    assert.ok([...dom.window.document.querySelectorAll('[data-reward-progress]')].every(host => host.hidden));
});
