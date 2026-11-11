const crypto = require('node:crypto');
const { InputError } = require('./validation');

const SESSION_COOKIE = 'popping_session';
const SESSION_MS = 3600000;

function sessions(secret) {
    const key = secret || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));
    const secure = process.env.NODE_ENV === 'production';
    function signature(value) { return crypto.createHmac('sha256', key).update(value).digest('base64url'); }
    function cookieValue(req, name) {
        const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
        return cookie ? cookie.slice(name.length + 1) : null;
    }
    // Reads a signed, unexpired JSON cookie. Returns null for anything tampered with or stale.
    function readSigned(req, name) {
        if (!key) return null;
        const raw = cookieValue(req, name);
        if (!raw) return null;
        const [payload, signed] = raw.split('.');
        if (!payload || !signed) return null;
        const expected = Buffer.from(signature(payload));
        const actual = Buffer.from(signed);
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
        try {
            const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
            return value.expires > Date.now() ? value : null;
        } catch { return null; }
    }
    function writeSigned(res, name, value, maxAge) {
        if (!key) throw new InputError('Employee sign-in is not configured. Contact your project administrator.', 503);
        const payload = Buffer.from(JSON.stringify({ ...value, expires: Date.now() + maxAge })).toString('base64url');
        res.cookie(name, `${payload}.${signature(payload)}`, { httpOnly: true, sameSite: 'lax', secure, maxAge });
    }
    function read(req) { return readSigned(req, SESSION_COOKIE); }
    function signIn(res, employee, view) {
        writeSigned(res, SESSION_COOKIE, { employeeId: employee.employee_id, name: employee.name,
            role: employee.role, view }, SESSION_MS);
    }
    return { read, signIn, readSigned, writeSigned, configured: Boolean(key) };
}

module.exports = { sessions };
