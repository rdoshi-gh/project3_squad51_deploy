window.POSSchedule = (() => {
    const { h, api, send, button, field, input, select, modal, confirm, announce } = POS;
    const addDays = (value, days) => {
        const date = new Date(`${value}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    };
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const monday = value => addDays(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
    const dayLabel = (value, weekday = false) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(weekday ? { weekday: 'short' } : { year: 'numeric' }) }).format(new Date(`${value}T12:00:00Z`));
    const timeLabel = value => {
        const [hour, minute] = value.split(':').map(Number);
        return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
    };
    const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
    const hours = shifts => (shifts.reduce((total, s) => total + minutes(s.end_time) - minutes(s.start_time), 0) / 60).toLocaleString('en-US', { maximumFractionDigits: 2 });

    function create({ editable = false, signal } = {}) {
        let week = monday(today()), data, busy = false, request, generation = 0;
        const root = h('section', { class: 'panel schedule-panel', 'aria-label': 'Employee schedule' });
        const error = h('p', { class: 'error', role: 'alert' });
        const heading = h('h1', {}, 'Schedule'), label = h('strong', { translate: 'no' });
        const date = input(week, 'date', { 'aria-label': 'Choose schedule date' });
        const status = h('p', { class: 'schedule-status', role: 'status' });
        const grid = h('div', { class: 'table-wrap schedule-scroll', tabindex: '0', 'aria-label': 'Weekly shift calendar' });
        const previous = button('Previous week', () => load(addDays(week, -7)));
        const next = button('Next week', () => load(addDays(week, 7)));
        const current = button('Today', () => load(monday(today())));
        const refresh = button('Refresh', () => load(week));
        const tools = h('div', { class: 'toolbar schedule-tools' }, previous, current, next, field('Week containing', date), refresh);
        const copy = button('Copy previous week', () => confirm('Copy Previous Week', 'Copy last week’s draft shifts into this empty week? Published shifts stay unchanged until you publish.', () => mutate('/copy'), 'Copy'));
        const publish = button('Publish week', () => confirm('Publish Schedule', 'Replace the cashier schedule for this week with the current draft? An empty draft clears the published week.', () => mutate('/publish'), 'Publish'), true);
        if (editable) tools.append(copy, publish);
        root.append(h('header', { class: 'schedule-header' }, heading, label), tools,
            h('p', { class: 'note' }, editable ? 'Click + Add shift on any day, or select a shift to edit it. Changes stay in draft until you publish. Times are store local (Central).' : 'Published team schedule · view only. Times are store local (Central).'), status, error, grid);
        date.addEventListener('change', () => { if (date.value) load(monday(date.value)); });
        const endpoint = editable ? '/api/manager/schedule' : '/api/schedule';
        function setBusy(value) {
            busy = value;
            root.setAttribute('aria-busy', String(value));
            tools.querySelectorAll('button, input').forEach(control => { control.disabled = value; });
            if (!value && editable) {
                copy.disabled = !data || data.shifts.some(s => s.status === 'draft');
                publish.disabled = !data;
            }
        }
        async function load(target) {
            request?.abort(); request = new AbortController();
            const seq = ++generation;
            error.textContent = ''; status.textContent = ''; data = null;
            grid.replaceChildren(h('p', { role: 'status' }, 'Loading schedule…'));
            setBusy(true);
            try {
                const result = await api(`${endpoint}?${new URLSearchParams({ week: target })}`, { signal: request.signal });
                if (seq !== generation || signal?.aborted) return;
                week = target; date.value = week; data = result;
                label.textContent = `${dayLabel(week)} – ${dayLabel(addDays(week, 6))}`;
                draw();
            } catch (err) {
                if (err.name !== 'AbortError' && !signal?.aborted && seq === generation) {
                    error.textContent = err.message;
                    grid.replaceChildren(h('p', {}, 'Schedule could not be loaded. Use Refresh to try again.'));
                }
            } finally { if (seq === generation && !signal?.aborted) setBusy(false); }
        }
        async function mutate(action) {
            if (busy || !data) return;
            setBusy(true);
            try { await send(`${endpoint}${action}`, 'POST', { week }); await load(week); }
            finally { setBusy(false); }
        }
        function draw() {
            const shifts = data.shifts.filter(s => s.status === (editable ? 'draft' : 'published'));
            const published = data.shifts.filter(s => s.status === 'published');
            const signature = list => JSON.stringify(list.map(s => [s.employee_id, s.shift_date, s.start_time, s.end_time, s.role].join('|')).sort());
            status.textContent = editable ? (signature(shifts) === signature(published) ? (shifts.length ? 'Published · draft matches cashier schedule' : 'No shifts this week') : 'Unpublished changes · cashiers see the last published schedule') : (shifts.length ? 'Published schedule' : 'No published shifts for this week.');
            const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
            const header = h('tr', {}, h('th', { scope: 'col' }, 'Employee / hours'), days.map(day => h('th', { scope: 'col', class: day === today() ? 'schedule-today' : '' }, h('span', { translate: 'no' }, dayLabel(day, true)))));
            const rows = data.employees.map(employee => {
                const assigned = shifts.filter(s => Number(s.employee_id) === Number(employee.employee_id));
                return h('tr', {}, h('th', { scope: 'row' }, h('span', { translate: 'no' }, employee.name), h('small', {}, `${hours(assigned)} hrs`)), days.map(day => {
                    const dayShifts = assigned.filter(s => s.shift_date === day);
                    return h('td', { class: day === today() ? 'schedule-today' : '' }, h('div', { class: 'schedule-cell' }, dayShifts.map(shift => {
                        const card = h(editable ? 'button' : 'div', { class: `schedule-shift ${shift.role === 'Manager' ? 'schedule-manager' : ''}`, ...(editable ? { type: 'button', 'aria-label': `Edit shift for ${employee.name}, ${day}, ${timeLabel(shift.start_time)} to ${timeLabel(shift.end_time)}`, onclick: () => { if (!busy) edit(employee, day, shift); } } : {}) },
                            h('strong', { translate: 'no' }, `${timeLabel(shift.start_time)} – ${timeLabel(shift.end_time)}`), h('small', {}, shift.role));
                        return card;
                    }), editable ? h('button', { type: 'button', class: 'schedule-add', 'aria-label': `Add shift for ${employee.name} on ${day}`, onclick: () => { if (!busy) edit(employee, day); } }, '+ Add shift') : (!dayShifts.length ? h('span', { class: 'schedule-off' }, '—') : null)));
                }));
            });
            const totals = h('tr', {}, h('th', { scope: 'row' }, 'Daily totals'), days.map(day => {
                const daily = shifts.filter(s => s.shift_date === day);
                const people = new Set(daily.map(s => s.employee_id)).size;
                return h('td', {}, `${people} staff`, h('small', {}, `${hours(daily)} hrs`));
            }));
            grid.replaceChildren(h('table', { class: 'schedule-table' }, h('caption', { class: 'sr-only' }, `Weekly schedule starting ${week}`), h('thead', {}, header), h('tbody', {}, rows), h('tfoot', {}, totals)));
            if (!data.employees.length) grid.append(h('p', { class: 'empty' }, editable ? 'Add employees in the Employees section to start scheduling.' : 'Check back after your manager publishes shifts.'));
        }
        function edit(employee, day, shift) {
            const selectedEmployee = select(data.employees.map(e => ({ value: e.employee_id, label: e.name })), employee.employee_id);
            const selectedDate = input(shift?.shift_date || day, 'date', { min: week, max: addDays(week, 6) });
            const start = input(shift?.start_time || '09:00', 'time');
            const end = input(shift?.end_time || '17:00', 'time');
            const role = select(['Cashier', 'Manager'].map(value => ({ value, label: value })), shift?.role || employee.role);
            if (!role.value) role.value = 'Cashier';
            const formError = h('p', { class: 'error', role: 'alert' });
            const form = h('form', {}, field('Employee', selectedEmployee), field('Date', selectedDate), h('div', { class: 'form-row' }, field('Start time', start), field('End time', end)), field('Shift role', role), h('p', { class: 'note' }, 'End time must be later on the same day. Times are Central.'), formError);
            const save = h('button', { type: 'submit', class: 'primary' }, 'Save shift');
            const cancel = button('Cancel', () => document.getElementById('modal').close());
            const remove = shift ? button('Delete shift', async () => act(() => send(`${endpoint}/shifts/${shift.shift_id}`, 'DELETE'))) : null;
            form.append(h('div', { class: 'dialog-footer' }, remove, cancel, save));
            async function act(action) {
                if (busy) return;
                if (end.value <= start.value && !action) { formError.textContent = 'End time must be after start time.'; return; }
                setBusy(true); formError.textContent = '';
                form.querySelectorAll('button').forEach(control => { control.disabled = true; });
                try {
                    if (action) await action();
                    else await send(`${endpoint}/shifts${shift ? `/${shift.shift_id}` : ''}`, shift ? 'PATCH' : 'POST', { employee_id: Number(selectedEmployee.value), week_start: week, shift_date: selectedDate.value, start_time: start.value, end_time: end.value, role: role.value });
                    document.getElementById('modal').close();
                    announce('Draft saved. Publish the week to share changes with cashiers.');
                    await load(week);
                } catch (err) { formError.textContent = err.message; }
                finally { setBusy(false); form.querySelectorAll('button').forEach(control => { control.disabled = false; }); }
            }
            form.addEventListener('submit', event => { event.preventDefault(); act(); });
            modal(shift ? 'Edit Shift' : 'Add Shift', form, [], { showClose: false });
        }
        signal?.addEventListener('abort', () => { request?.abort(); generation++; }, { once: true });
        load(week);
        return root;
    }
    const toggle = document.getElementById('cashier-schedule-toggle');
    toggle?.addEventListener('click', () => {
        const target = document.getElementById('cashier-schedule');
        const opening = target.hidden;
        if (opening && !target.childElementCount) target.append(create());
        target.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
        if (opening) target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return { create };
})();
