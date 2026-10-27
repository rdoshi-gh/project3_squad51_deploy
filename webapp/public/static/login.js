(() => {
    const { api, send } = POS;
    const view = document.body.dataset.view;
    const form = document.getElementById('login-form');
    const employees = document.getElementById('employee');
    const submit = document.getElementById('sign-in');
    const retry = document.getElementById('retry-login');
    const error = document.getElementById('login-error');
    async function load() {
        error.textContent = ''; retry.hidden = true; employees.disabled = true; submit.disabled = true;
        try {
            const rows = await api(`/api/login-employees?view=${view}`);
            employees.replaceChildren(new Option('Select employee', ''), ...rows.map(row => new Option(`${row.name} · ${row.role} · #${row.employee_id}`, row.employee_id)));
            employees.disabled = !rows.length; submit.disabled = !rows.length;
            if (!rows.length) error.textContent = 'No employees available for this view.';
        } catch (err) { error.textContent = err.message; retry.hidden = false; }
    }
    retry.addEventListener('click', load);
    form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled = true; error.textContent = '';
        try { const result = await send('/api/session', 'POST', { view, employeeId: employees.value }); location.assign(result.location); }
        catch (err) { error.textContent = err.message; submit.disabled = false; }
    });
    load();
})();
