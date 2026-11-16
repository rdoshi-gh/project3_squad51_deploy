const { InputError, id, dateRange } = require('./validation');

function weekStart(value) {
    dateRange(value, value);
    if (new Date(`${value}T00:00:00Z`).getUTCDay() !== 1) throw new InputError('Choose a Monday for the schedule week.');
    return value;
}
function shiftValues(body) {
    const week = weekStart(body.week_start);
    dateRange(body.shift_date, body.shift_date);
    const offset = (Date.parse(body.shift_date) - Date.parse(week)) / 86400000;
    if (offset < 0 || offset > 6) throw new InputError('The shift must be within the selected week.');
    for (const value of [body.start_time, body.end_time]) {
        if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new InputError('Choose valid shift times.');
    }
    if (body.end_time <= body.start_time) throw new InputError('End time must be after start time. Split overnight shifts into separate days.');
    if (!['Manager', 'Cashier'].includes(body.role)) throw new InputError('Choose Manager or Cashier.');
    return [id(body.employee_id), week, body.shift_date, body.start_time, body.end_time, body.role];
}
// Serialize writes so concurrent managers cannot overlap shifts or partially publish edits.
async function writeSchedule(db, work) {
    return db.transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(51, 332)');
        return work(client);
    });
}
async function readSchedule(db, week, manager) {
    weekStart(week);
    const shifts = await db.query(`SELECT s.shift_id, s.employee_id, TO_CHAR(s.week_start, 'YYYY-MM-DD') AS week_start,
        TO_CHAR(s.shift_date, 'YYYY-MM-DD') AS shift_date, TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
        TO_CHAR(s.end_time, 'HH24:MI') AS end_time, s.role, s.status, e.name
        FROM employee_shifts s JOIN employees e USING(employee_id)
        WHERE s.week_start = $1 ${manager ? '' : "AND s.status = 'published'"}
        ORDER BY s.shift_date, s.start_time, s.shift_id`, [week]);
    const employees = manager ? await db.query('SELECT employee_id, name, role FROM employees ORDER BY name, employee_id') :
        [...new Map(shifts.map(s => [s.employee_id, { employee_id: s.employee_id, name: s.name, role: s.role }])).values()];
    return { week, employees, shifts };
}
async function saveShift(db, body, shiftId) {
    const values = shiftValues(body);
    return writeSchedule(db, async client => {
        if (shiftId) {
            const current = await client.query("SELECT shift_id FROM employee_shifts WHERE shift_id = $1 AND week_start = $2 AND status = 'draft'", [shiftId, values[1]]);
            if (!current.rows.length) throw new InputError('Draft shift not found. Refresh the schedule.', 404);
        }
        const employee = await client.query('SELECT employee_id FROM employees WHERE employee_id = $1', [values[0]]);
        if (!employee.rows.length) throw new InputError('Employee no longer exists.', 409);
        const overlap = await client.query(`SELECT shift_id FROM employee_shifts WHERE employee_id = $1 AND shift_date = $2
            AND status = 'draft' AND start_time < $4::time AND end_time > $3::time
            AND ($5::integer IS NULL OR shift_id <> $5)`, [values[0], values[2], values[3], values[4], shiftId || null]);
        if (overlap.rows.length) throw new InputError('This employee already has an overlapping shift.', 409);
        const result = shiftId ? await client.query(`UPDATE employee_shifts SET employee_id=$1, week_start=$2, shift_date=$3,
            start_time=$4, end_time=$5, role=$6 WHERE shift_id=$7 AND status='draft' RETURNING shift_id`, [...values, shiftId]) :
            await client.query(`INSERT INTO employee_shifts(employee_id, week_start, shift_date, start_time, end_time, role)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING shift_id`, values);
        return result.rows[0];
    });
}
async function deleteShift(db, shiftId) {
    return writeSchedule(db, async client => {
        const result = await client.query("DELETE FROM employee_shifts WHERE shift_id = $1 AND status = 'draft' RETURNING shift_id", [shiftId]);
        if (!result.rows.length) throw new InputError('Draft shift not found. Refresh the schedule.', 404);
        return { ok: true };
    });
}
async function publishWeek(db, week) {
    weekStart(week);
    return writeSchedule(db, async client => {
        await client.query("DELETE FROM employee_shifts WHERE week_start = $1 AND status = 'published'", [week]);
        await client.query(`INSERT INTO employee_shifts(employee_id, week_start, shift_date, start_time, end_time, role, status)
            SELECT employee_id, week_start, shift_date, start_time, end_time, role, 'published'
            FROM employee_shifts WHERE week_start = $1 AND status = 'draft'`, [week]);
        return { ok: true };
    });
}
async function copyWeek(db, week) {
    weekStart(week);
    return writeSchedule(db, async client => {
        const existing = await client.query("SELECT shift_id FROM employee_shifts WHERE week_start = $1 AND status = 'draft'", [week]);
        if (existing.rows.length) throw new InputError('Copy is available only when this week has no draft shifts.', 409);
        const result = await client.query(`INSERT INTO employee_shifts(employee_id, week_start, shift_date, start_time, end_time, role)
            SELECT employee_id, $1::date, shift_date + 7, start_time, end_time, role
            FROM employee_shifts WHERE week_start = $1::date - 7 AND status = 'draft' RETURNING shift_id`, [week]);
        if (!result.rows.length) throw new InputError('There are no draft shifts in the previous week to copy.');
        return { ok: true, count: result.rows.length };
    });
}
module.exports = { weekStart, shiftValues, readSchedule, saveShift, deleteShift, publishWeek, copyWeek };
