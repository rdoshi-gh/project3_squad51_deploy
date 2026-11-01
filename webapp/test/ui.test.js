const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUi, flush, response } = require('./helpers/ui');

for (const view of ['manager', 'cashier']) {
    test(`${view} confirms logout and replaces the workspace with the role picker`, async t => {
        const ui = await createUi({ view, fetch: async () => response({ ok: true, location: '/' }) });
        t.after(() => ui.dom.window.close());
        ui.document.getElementById('logout').click();
        assert.equal(ui.dialog.open, true);
        assert.equal(ui.requests.length, 0, 'opening the confirmation does not sign out');
        ui.findButton('Log Out').click();
        await flush();
        assert.equal(ui.requests[0].url, '/api/logout');
        assert.equal(ui.requests[0].options.method, 'POST');
        assert.deepEqual(ui.navigation, [{ method: 'replace', url: '/' }]);
        assert.equal(ui.dialog.open, false);
    });
}

test('cancelling logout keeps the workspace and sends no logout request', async t => {
    const ui = await createUi();
    t.after(() => ui.dom.window.close());
    ui.document.getElementById('logout').click();
    ui.findButton('Cancel').click();
    await flush();
    assert.equal(ui.dialog.open, false);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.navigation.length, 0);
});

test('failed logout remains visible and can be retried', async t => {
    let attempts = 0;
    const ui = await createUi({ fetch: async () => ++attempts === 1 ? response({ error: 'Please try again.' }, 503) : response({ ok: true, location: '/' }) });
    t.after(() => ui.dom.window.close());
    ui.document.getElementById('logout').click();
    ui.findButton('Log Out').click();
    await flush();
    assert.equal(ui.dialog.open, true);
    assert.match(ui.dialog.textContent, /Please try again/);
    assert.equal(ui.navigation.length, 0);
    assert.equal(ui.findButton('Log Out').disabled, false);
    ui.findButton('Log Out').click();
    await flush();
    assert.deepEqual(ui.navigation, [{ method: 'replace', url: '/' }]);
});

test('logout confirmation has one Cancel control and its primary action', async t => {
    const ui = await createUi();
    t.after(() => ui.dom.window.close());
    ui.document.getElementById('logout').click();
    assert.deepEqual([...ui.dialog.querySelectorAll('button')].map(control => control.textContent), ['Cancel', 'Log Out']);
    ui.findButton('Cancel').click();
    assert.equal(ui.dialog.open, false);
});

test('read-only profile dialogs retain a single Close control', async t => {
    const ui = await createUi();
    t.after(() => ui.dom.window.close());
    ui.document.getElementById('profile').click();
    assert.deepEqual([...ui.dialog.querySelectorAll('button')].map(control => control.textContent), ['Close']);
    ui.findButton('Close').click();
    assert.equal(ui.dialog.open, false);
});
