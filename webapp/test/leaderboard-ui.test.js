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
