const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');

for (const [view, employeeId] of [['manager', 1], ['cashier', 2]]) {
    test(`${view} logout clears the session and returns the existing role picker`, async t => {
        const db = { query: async () => [{ employee_id: employeeId, name: 'Test Employee', role: view === 'manager' ? 'Manager' : 'Cashier' }] };
        const server = createApp({ db, secret: 'logout-regression-test-secret' }).listen(0, '127.0.0.1');
        t.after(() => new Promise(resolve => server.close(resolve)));
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view, employeeId }) });
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        assert.equal((await fetch(`${base}/${view}`, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 200);
        const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { ok: true, location: '/' });
        assert.match(logout.headers.get('set-cookie'), /popping_session=;.*Expires=Thu, 01 Jan 1970/);
        const picker = await fetch(base);
        const html = await picker.text();
        assert.equal(picker.status, 200);
        assert.match(html, /href="\/manager\/login"/);
        assert.match(html, /href="\/cashier\/login"/);
        const clearedCookie = logout.headers.get('set-cookie').split(';')[0];
        assert.equal((await fetch(`${base}/${view}`, { headers: { Cookie: clearedCookie }, redirect: 'manual' })).status, 302);
        const protectedApi = view === 'manager' ? '/api/manager/inventory' : '/api/menu';
        assert.equal((await fetch(`${base}${protectedApi}`, { headers: { Cookie: clearedCookie } })).status, 401);
    });
}
