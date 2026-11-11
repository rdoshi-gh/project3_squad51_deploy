const crypto = require('node:crypto');

// Google OAuth 2.0 / OpenID Connect sign-in for kiosk customers (loyalty points).
// Server-side authorization code flow: https://developers.google.com/identity/protocols/oauth2/web-server
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const STATE_COOKIE = 'popping_oauth';
const STATE_MS = 10 * 60 * 1000;
const CUSTOMER_COOKIE = 'popping_customer';
// The kiosk is a shared public screen, so customer sign-ins are short-lived.
const CUSTOMER_MS = 15 * 60 * 1000;

// Short codes are put in the kiosk URL; the message text stays on the server.
const MESSAGES = {
    not_configured: 'Google sign-in is not configured on this server yet.',
    cancelled: 'Google sign-in was cancelled.',
    expired: 'Your sign-in attempt expired. Please try again.',
    failed: 'Google sign-in failed. Please try again.',
    unverified: 'Your Google email address is not verified.'
};

function readCustomer(session, req) { return session.readSigned(req, CUSTOMER_COOKIE); }
function signOutCustomer(res) { res.clearCookie(CUSTOMER_COOKIE); }

function googleAuth({ app, db, session, fetchImpl = fetch, env = process.env }) {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const enabled = Boolean(clientId && clientSecret && session.configured);

    // Google requires an exact match with a redirect URI registered in the Cloud console.
    function redirectUri(req) {
        const base = (env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        return `${base}/auth/google/callback`;
    }
    const fail = (res, code) => res.redirect(`/kiosk?signin_error=${code}`);

    app.get('/auth/google/customer', (req, res) => {
        if (!enabled) return fail(res, 'not_configured');
        const state = crypto.randomBytes(24).toString('base64url');
        const nonce = crypto.randomBytes(24).toString('base64url');
        session.writeSigned(res, STATE_COOKIE, { state, nonce }, STATE_MS);
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri(req),
            response_type: 'code',
            scope: 'openid email profile',
            state,
            nonce,
            prompt: 'select_account'
        });
        res.redirect(`${AUTH_URL}?${params}`);
    });

    app.get('/auth/google/callback', async (req, res, next) => {
        const pending = session.readSigned(req, STATE_COOKIE);
        res.clearCookie(STATE_COOKIE);
        try {
            if (!enabled) return fail(res, 'not_configured');
            if (!pending || typeof req.query.state !== 'string' || !safeEqual(req.query.state, pending.state)) return fail(res, 'expired');
            if (req.query.error) return fail(res, req.query.error === 'access_denied' ? 'cancelled' : 'failed');
            if (typeof req.query.code !== 'string') return fail(res, 'failed');

            const tokenResponse = await fetchImpl(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code: req.query.code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri(req),
                    grant_type: 'authorization_code'
                })
            });
            const tokens = await tokenResponse.json().catch(() => ({}));
            if (!tokenResponse.ok || !tokens.id_token) {
                console.error('Google token exchange failed:', tokens.error || tokenResponse.status);
                return fail(res, 'failed');
            }
            // The ID token came straight from Google's token endpoint over TLS, so per
            // OpenID Connect Core 3.1.3.7 its claims can be checked without verifying the signature.
            const claims = decodeJwt(tokens.id_token);
            if (!claims || !ISSUERS.includes(claims.iss) || claims.aud !== clientId
                || claims.nonce !== pending.nonce || !(claims.exp * 1000 > Date.now())) return fail(res, 'failed');
            if (!claims.email || claims.email_verified !== true) return fail(res, 'unverified');

            // Customers enroll on first sign-in; returning customers keep their points.
            const [customer] = await db.query(`INSERT INTO customers (email) VALUES (LOWER($1))
                ON CONFLICT (LOWER(email)) DO UPDATE SET email = customers.email RETURNING customer_id`, [claims.email]);
            session.writeSigned(res, CUSTOMER_COOKIE, { customerId: customer.customer_id,
                firstName: String(claims.given_name || '').slice(0, 40) }, CUSTOMER_MS);
            res.redirect('/kiosk');
        } catch (error) { next(error); }
    });

    return { enabled, message: code => MESSAGES[code] || null };
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a)), right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decodeJwt(token) {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
    catch { return null; }
}

module.exports = { googleAuth, readCustomer, signOutCustomer };
