const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');

const env = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

async function start(t, { claims = {}, appEnv = env } = {}) {
    const calls = [];
    const db = { query: async (sql, values) => { calls.push({ sql, values }); return [{ customer_id: 3, points: 12 }]; } };
    let nonce;
    const fetchImpl = async (url, options) => {
        assert.equal(url, 'https://oauth2.googleapis.com/token');
        const body = new URLSearchParams(options.body);
        assert.equal(body.get('code'), 'auth-code');
        assert.equal(body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
        const idToken = [b64({ alg: 'RS256' }), b64({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + 300, email: 'Reveille.BubbleTea@gmail.com', email_verified: true,
            given_name: 'Rev', nonce, ...claims }), 'sig'].join('.');
        return { ok: true, json: async () => ({ id_token: idToken }) };
    };
    const server = createApp({ db, secret: 'google-auth-test-secret', fetchImpl, env: appEnv }).listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function signIn() {
        const begin = await fetch(`${base}/auth/google/customer`, { redirect: 'manual' });
        assert.equal(begin.status, 302);
        const google = new URL(begin.headers.get('location'));
        assert.equal(google.origin + google.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
        assert.equal(google.searchParams.get('redirect_uri'), `${base}/auth/google/callback`);
        assert.equal(google.searchParams.get('scope'), 'openid email profile');
        nonce = google.searchParams.get('nonce');
        const stateCookie = begin.headers.get('set-cookie').split(';')[0];
        return fetch(`${base}/auth/google/callback?code=auth-code&state=${google.searchParams.get('state')}`,
            { headers: { Cookie: stateCookie }, redirect: 'manual' });
    }
    return { base, calls, signIn };
}

test('the kiosk shows the Google button and employee logins keep the picker', async t => {
    const { base } = await start(t);
    assert.match(await (await fetch(`${base}/kiosk`)).text(), /href="\/auth\/google\/customer"/);
    for (const view of ['manager', 'cashier', 'kitchen']) {
        assert.doesNotMatch(await (await fetch(`${base}/${view}/login`)).text(), /auth\/google/);
        assert.equal((await fetch(`${base}/auth/google/${view}`, { redirect: 'manual' })).status, 404);
    }
});

test('a customer Google sign-in enrolls them and shows their points on the kiosk', async t => {
    const { base, calls, signIn } = await start(t);
    const done = await signIn();
    assert.equal(done.headers.get('location'), '/kiosk');
    assert.match(calls.at(-1).sql, /INSERT INTO customers/);
    assert.deepEqual(calls.at(-1).values, ['Reveille.BubbleTea@gmail.com']);
    const cookie = done.headers.get('set-cookie').split(', ').find(c => c.startsWith('popping_customer=')).split(';')[0];
    const html = await (await fetch(`${base}/kiosk`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /Hi Rev!/);
    assert.match(html, /<strong>12<\/strong> points/);
    const signOut = await fetch(`${base}/kiosk/sign-out`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
    assert.match(signOut.headers.get('set-cookie'), /popping_customer=;/);
});

test('a token for another client is rejected', async t => {
    const { signIn } = await start(t, { claims: { aud: 'someone-else' } });
    assert.equal((await signIn()).headers.get('location'), '/kiosk?signin_error=failed');
});

test('an unverified Google email is rejected', async t => {
    const { signIn } = await start(t, { claims: { email_verified: false } });
    assert.equal((await signIn()).headers.get('location'), '/kiosk?signin_error=unverified');
});

test('a callback without the matching state cookie is rejected', async t => {
    const { base } = await start(t);
    const done = await fetch(`${base}/auth/google/callback?code=auth-code&state=forged`, { redirect: 'manual' });
    assert.equal(done.headers.get('location'), '/kiosk?signin_error=expired');
    const html = await (await fetch(`${base}/kiosk?signin_error=expired`)).text();
    assert.match(html, /Your sign-in attempt expired/);
});

test('Google sign-in is hidden when not configured', async t => {
    const { base } = await start(t, { appEnv: {} });
    assert.doesNotMatch(await (await fetch(`${base}/kiosk`)).text(), /auth\/google/);
    assert.equal((await fetch(`${base}/auth/google/customer`, { redirect: 'manual' })).headers.get('location'), '/kiosk?signin_error=not_configured');
});

test('customers earn one point per whole dollar', () => {
    const { pointsFor } = require('../lib/orders');
    assert.equal(pointsFor(11.5), 11);
    assert.equal(pointsFor(0.99), 0);
});
