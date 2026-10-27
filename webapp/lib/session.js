const crypto = require('node:crypto');
const { InputError } = require('./validation');

function sessions(secret) {
    const key = secret || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));
    function signature(value) { return crypto.createHmac('sha256', key).update(value).digest('base64url'); }
    function read(req) {
        if (!key) return null;
        const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('popping_session='));
        if (!cookie) return null;
        const [payload, signed] = cookie.slice('popping_session='.length).split('.');
        if (!payload || !signed) return null;
        const expected = Buffer.from(signature(payload));
        const actual = Buffer.from(signed);
        if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
        try {
            const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
            return session.expires > Date.now() ? session : null;
        } catch { return null; }
    }
    function signIn(res, employee, view) {
        if (!key) throw new InputError('Employee sign-in is not configured. Contact your project administrator.', 503);
        const payload = Buffer.from(JSON.stringify({ employeeId: employee.employee_id, name: employee.name,
            role: employee.role, view, expires: Date.now() + 3600000 })).toString('base64url');
        res.cookie('popping_session', `${payload}.${signature(payload)}`, {
            httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 3600000
        });
    }
    return { read, signIn };
}

module.exports = { sessions };
