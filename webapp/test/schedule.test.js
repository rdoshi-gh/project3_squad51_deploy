const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weekStart, shiftValues, saveShift, readSchedule, publishWeek } = require('../lib/schedule');
const { createApp } = require('../application');
const { createUi, response, flush } = require('./helpers/ui');
const valid = { employee_id: 2, week_start: '2026-11-16', shift_date: '2026-11-16', start_time: '09:00', end_time: '17:00', role: 'Cashier' };

test('schedule validates real dates, Monday weeks, week boundaries and same-day times', () => {
    assert.equal(weekStart('2026-11-16'), '2026-11-16');
    for (const value of [undefined, '2026-02-30', '2026-11-17']) assert.throws(() => weekStart(value));
    assert.deepEqual(shiftValues(valid), [2, '2026-11-16', '2026-11-16', '09:00', '17:00', 'Cashier']);
    for (const change of [{ shift_date: '2026-11-23' }, { shift_date: '2026-11-15' }, { end_time: '08:00' }, { end_time: '09:00' }, { start_time: '24:00' }, { start_time: '9:00' }, { employee_id: 0 }, { role: 'Admin' }]) assert.throws(() => shiftValues({ ...valid, ...change }));
});

test('overlap conflict rejects the draft without inserting; adjacent boundary query is strict', async () => {
    const calls = [];
    const db = { transaction: work => work({ query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM employees')) return { rows: [{ employee_id: 2 }] };
        if (sql.includes('start_time <')) return { rows: [{ shift_id: 4 }] };
        return { rows: [] };
    } }) };
    await assert.rejects(saveShift(db, valid), error => error.status === 409);
    assert.match(calls[0].sql, /pg_advisory_xact_lock/);
    assert.match(calls[2].sql, /start_time < \$4::time AND end_time > \$3::time/);
    assert.ok(!calls.some(c => c.sql.includes('INSERT')));
});

test('cashier schedule query filters published records and never lists all employees', async () => {
    const calls = [];
    const data = await readSchedule({ query: async sql => { calls.push(sql); return []; } }, '2026-11-16', false);
    assert.match(calls[0], /AND s.status = 'published'/);
    assert.equal(calls.length, 1);
    assert.deepEqual(data.employees, []);
});

test('publishing replaces the published snapshot in one serialized transaction and retains drafts', async () => {
    const calls = [];
    await publishWeek({ transaction: work => work({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } }) }, '2026-11-16');
    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /pg_advisory_xact_lock/);
    assert.match(calls[1].sql, /status = 'published'/);
    assert.match(calls[2].sql, /INSERT INTO employee_shifts/);
    assert.match(calls[2].sql, /status = 'draft'/);
});

test('anonymous and cashier sessions cannot write schedules; cashier can read published shifts', async t => {
    const db = { query: async sql => sql.includes('WHERE employee_id = $1') ? [{ employee_id: 2, name: 'Cashier', role: 'Cashier' }] : [] };
    const server = createApp({ db, env: {}, secret: 'schedule-test-secret' }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/schedule?week=2026-11-16`)).status, 401);
    const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'cashier', employeeId: 2 }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/schedule?week=2026-11-16`, { headers: { Cookie: cookie } })).status, 200);
    for (const [path, method] of [['shifts', 'POST'], ['shifts/1', 'PATCH'], ['shifts/1', 'DELETE'], ['publish', 'POST'], ['copy', 'POST']]) {
        assert.equal((await fetch(`${base}/api/manager/schedule/${path}`, { method })).status, 401);
        assert.equal((await fetch(`${base}/api/manager/schedule/${path}`, { method, headers: { Cookie: cookie } })).status, 403);
    }
});

test('manager calendar edits draft shifts and only publishes on explicit action', async t => {
    let shifts = [];
    const ui = await createUi({ view: 'manager', page: 'schedule', fetch: async (url, options = {}) => {
        if (options.method) {
            const body = JSON.parse(options.body);
            if (url.endsWith('/shifts')) shifts.push({ ...body, shift_id: 1, status: 'draft' });
            return response({ ok: true });
        }
        const week = new URL(url, 'http://localhost').searchParams.get('week');
        return response({ week, employees: [{ employee_id: 2, name: '<Cashier>', role: 'Cashier' }], shifts });
    } });
    t.after(() => ui.window.close());
    ui.run('schedule'); ui.run('manager'); await flush();
    const root = ui.document.querySelector('.schedule-panel');
    assert.equal(root.querySelectorAll('.schedule-add').length, 7);
    assert.match(root.textContent, /<Cashier>/);
    assert.equal(root.querySelector('Cashier'), null);
    root.querySelector('.schedule-add').click();
    ui.dialog.querySelector('form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }));
    await flush(); await flush();
    assert.equal(ui.dialog.open, false);
    assert.equal(root.querySelectorAll('.schedule-shift').length, 1);
    assert.match(root.textContent, /Unpublished changes/);
    assert.equal(ui.requests.filter(r => r.url.endsWith('/publish')).length, 0);
    ui.findButton('Publish week', root).click();
    ui.findButton('Publish').click(); await flush();
    assert.equal(ui.requests.filter(r => r.url.endsWith('/publish')).length, 1);
});

test('cashier Schedule toggles a read-only calendar without fetching menu or allowing writes', async t => {
    const ui = await createUi({ fetch: async url => {
        const week = new URL(url, 'http://localhost').searchParams.get('week');
        return response({ week, employees: [{ employee_id: 2, name: 'Cashier', role: 'Cashier' }], shifts: [{ ...valid, week_start: week, shift_date: week, shift_id: 2, status: 'published' }] });
    } });
    t.after(() => ui.window.close());
    ui.run('schedule');
    assert.equal(ui.requests.length, 0);
    const toggle = ui.document.getElementById('cashier-schedule-toggle');
    toggle.click(); await flush();
    const root = ui.document.getElementById('cashier-schedule');
    assert.equal(root.hidden, false);
    assert.equal(root.querySelectorAll('.schedule-shift').length, 1);
    assert.equal(root.querySelectorAll('.schedule-add, button.schedule-shift').length, 0);
    assert.match(root.textContent, /8 hrs/);
    assert.ok(ui.requests.every(r => r.url.startsWith('/api/schedule?') && !r.options.method));
    toggle.click(); assert.equal(root.hidden, true);
});
