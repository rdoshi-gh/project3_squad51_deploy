const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const { readFileSync } = require('node:fs');
const path = require('node:path');

async function openLeaderboard(t, fetchImpl, googleEnabled = true) {
    const html = await ejs.renderFile(path.join(__dirname, '../views/leaderboard.ejs'), { googleEnabled });
    const dom = new JSDOM(html, { url: 'http://localhost/leaderboard', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.fetch = fetchImpl;
    for (const script of ['common', 'leaderboard']) {
        dom.window.eval(readFileSync(path.join(__dirname, `../public/static/${script}.js`), 'utf8'));
    }
    return { w: dom.window, d: dom.window.document };
}

async function until(check) {
    for (let i = 0; i < 50; i++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('Timed out waiting for leaderboard state');
}
const json = value => ({ ok: true, json: async () => value });
const leaders = [
    { rank: 1, displayName: '<img src=x onerror=alert(1)>', lifetimePoints: 120, isYou: false },
    { rank: 1, displayName: 'Boba Buddy', lifetimePoints: 120, isYou: true },
    { rank: 3, displayName: 'Tea fan', lifetimePoints: 95, isYou: false }
];

test('the leaderboard shows shared ranks, Lifetime Points, and inert customer names', async t => {
    const { d } = await openLeaderboard(t, async () => json({ leaders, me: null }));
    await until(() => d.querySelector('tbody tr'));
    assert.deepEqual([...d.querySelectorAll('.leaderboard-rank')].map(el => el.textContent), ['#1', '#1', '#3']);
    assert.match(d.querySelector('thead').textContent, /Lifetime Points/);
    assert.equal(d.querySelector('.leaderboard-name').textContent, leaders[0].displayName);
    assert.equal(d.querySelector('tbody img'), null);
    assert.equal(d.querySelector('.leaderboard-name').getAttribute('translate'), 'no');
    assert.equal(d.querySelector('.leaderboard-you-label').textContent, 'You');
    assert.equal(d.getElementById('leaderboard-signin').hidden, false);
    assert.match(d.querySelector('a[href^="/auth/google"]').getAttribute('href'), /returnTo=\/leaderboard/);
});

test('empty and unavailable leaderboard states remain usable and Refresh recovers', async t => {
    let request = 0;
    const { d } = await openLeaderboard(t, async () => {
        request++;
        if (request === 1) throw new Error('Could not connect.');
        return json({ leaders: [], me: null });
    });
    await until(() => !d.getElementById('leaderboard-error').hidden);
    assert.match(d.getElementById('leaderboard-error').textContent, /Could not connect/);
    d.getElementById('leaderboard-refresh').click();
    await until(() => d.getElementById('leaderboard-error').hidden && !d.getElementById('leaderboard-refresh').disabled);
    assert.match(d.getElementById('leaderboard-results').textContent, /No Lifetime Points yet/);
    assert.equal(d.getElementById('leaderboard-results').getAttribute('aria-busy'), 'false');
});

test('a refresh error preserves the last successful ranking', async t => {
    let fail = false;
    const { d } = await openLeaderboard(t, async () => {
        if (fail) throw new Error('Refresh failed.');
        return json({ leaders, me: null });
    });
    await until(() => d.querySelector('tbody tr'));
    fail = true;
    d.getElementById('leaderboard-refresh').click();
    await until(() => !d.getElementById('leaderboard-error').hidden);
    assert.equal(d.querySelectorAll('tbody tr').length, 3);
});

test('the public page is still available when local Google OAuth is not configured', async t => {
    const { d } = await openLeaderboard(t, async () => json({ leaders: [], me: null }), false);
    await until(() => !d.getElementById('leaderboard-signin').hidden);
    assert.equal(d.querySelector('a[href^="/auth/google"]'), null);
    assert.match(d.getElementById('leaderboard-signin').textContent, /Google sign-in is currently unavailable/);
});

const me = { displayName: 'Boba fan #12', hasDisplayName: false, rank: 12, lifetimePoints: 20, points: 75 };

test('the personal panel distinguishes Lifetime Points, balance, and an outside-Top-10 rank', async t => {
    const { d } = await openLeaderboard(t, async () => json({ leaders, me }));
    await until(() => !d.getElementById('leaderboard-personal').hidden);
    assert.equal(d.getElementById('leaderboard-my-rank').textContent, '#12');
    assert.equal(d.getElementById('leaderboard-my-points').textContent, '20');
    assert.equal(d.getElementById('leaderboard-my-balance').textContent, '75');
    assert.equal(d.getElementById('leaderboard-display-name').value, '', 'anonymous labels are not submitted as chosen names');
    assert.equal(d.getElementById('leaderboard-signin').hidden, true);
});

test('zero Lifetime Points show an unranked state even with a spendable balance', async t => {
    const { d } = await openLeaderboard(t, async () => json({ leaders, me: { ...me, rank: null, lifetimePoints: 0 } }));
    await until(() => !d.getElementById('leaderboard-personal').hidden);
    assert.equal(d.getElementById('leaderboard-my-rank').textContent, 'Not ranked yet');
    assert.equal(d.getElementById('leaderboard-unranked').hidden, false);
});

test('Refresh preserves an unsaved display name, then save updates the public ranking', async t => {
    let name = null;
    const writes = [];
    const { d, w } = await openLeaderboard(t, async (url, options) => {
        if (options?.method === 'PATCH') {
            writes.push(JSON.parse(options.body)); name = writes.at(-1).displayName.trim();
            return json({ displayName: name });
        }
        return json({ leaders: name ? [{ rank: 1, displayName: name, lifetimePoints: 20, isYou: true }] : [],
            me: { ...me, displayName: name || me.displayName, hasDisplayName: Boolean(name) } });
    });
    await until(() => !d.getElementById('leaderboard-personal').hidden);
    const input = d.getElementById('leaderboard-display-name');
    input.value = '  Tea Explorer  '; input.dispatchEvent(new w.Event('input'));
    d.getElementById('leaderboard-refresh').click();
    await until(() => !d.getElementById('leaderboard-refresh').disabled);
    assert.equal(input.value, '  Tea Explorer  ');
    d.getElementById('leaderboard-name-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await until(() => d.querySelector('.leaderboard-name')?.textContent === 'Tea Explorer');
    assert.deepEqual(writes, [{ displayName: '  Tea Explorer  ' }]);
    assert.equal(input.value, 'Tea Explorer');
    assert.match(d.getElementById('leaderboard-name-message').textContent, /saved/);
});

test('a pending name save prevents duplicates and a failed save preserves the draft for retry', async t => {
    let release, writes = 0;
    const { d, w } = await openLeaderboard(t, async (url, options) => {
        if (options?.method === 'PATCH') {
            writes++;
            return new Promise(resolve => { release = () => resolve({ ok: false, status: 401,
                json: async () => ({ error: 'Sign in with Google to choose a display name.' }) }); });
        }
        return json({ leaders, me });
    });
    await until(() => !d.getElementById('leaderboard-personal').hidden);
    const form = d.getElementById('leaderboard-name-form');
    d.getElementById('leaderboard-display-name').value = 'Tea Explorer';
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    assert.equal(writes, 1);
    assert.equal(d.getElementById('leaderboard-save-name').disabled, true);
    release();
    await until(() => !d.getElementById('leaderboard-save-name').disabled);
    assert.match(d.getElementById('leaderboard-name-message').textContent, /Sign in with Google/);
    assert.equal(d.getElementById('leaderboard-name-message').getAttribute('role'), 'alert');
    assert.equal(d.getElementById('leaderboard-display-name').value, 'Tea Explorer');
});

test('shared accessibility and translation preserve customer names and editable input', async t => {
    const batches = [];
    const { d, w } = await openLeaderboard(t, async (url, options) => {
        if (url === '/api/translate') {
            const { texts } = JSON.parse(options.body); batches.push(...texts);
            return json({ translations: texts.map(text => `ES ${text}`) });
        }
        return json({ leaders: [{ rank: 1, displayName: 'Private Display Name', lifetimePoints: 20, isYou: true }],
            me: { ...me, displayName: 'Private Display Name', hasDisplayName: true } });
    });
    await until(() => !d.getElementById('leaderboard-personal').hidden);
    w.TextEncoder = TextEncoder;
    w.localStorage.setItem('pos-accessibility-settings', JSON.stringify({ language: 'es', textScale: 1.5, controlScale: 1.5, highContrast: true, readableSpacing: true }));
    const observers = [], Observer = w.MutationObserver;
    w.MutationObserver = class extends Observer { constructor(callback) { super(callback); observers.push(this); } };
    t.after(() => observers.forEach(observer => observer.disconnect()));
    for (const script of ['accessibility', 'translation']) w.eval(readFileSync(path.join(__dirname, `../public/static/${script}.js`), 'utf8'));
    await until(() => d.documentElement.lang === 'es' && batches.length && d.getElementById('translation-feedback').hidden);
    assert.equal(d.querySelector('.leaderboard-name').textContent, 'Private Display Name');
    assert.equal(d.getElementById('leaderboard-display-name').value, 'Private Display Name');
    assert.equal(d.body.classList.contains('accessibility-high-contrast'), true);
    assert.ok(!batches.some(text => text.includes('Private Display Name')));
    d.getElementById('accessibility-language').value = 'en';
    d.getElementById('accessibility-language').dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('.leaderboard-name').textContent, 'Private Display Name');
});
