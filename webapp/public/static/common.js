/* Shared DOM helpers keep database text out of HTML strings. */
window.POS = (() => {
    const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
    const numeric = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(value) || 0);
    const dateTime = value => value ? new Date(value).toLocaleString() : '—';
    function presetDates(range, days) {
        const first = new Date(`${range.last}T00:00:00Z`);
        if (days !== null) first.setUTCDate(first.getUTCDate() - days + 1);
        return { start: days === null ? range.first : first.toISOString().slice(0, 10), end: range.last };
    }
    function h(tag, attrs = {}, ...children) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
            else if (key === 'class') element.className = value;
            else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden') element[key] = value;
            else if (value !== undefined && value !== null) element.setAttribute(key, value);
        }
        for (const child of children.flat(Infinity)) {
            if (child !== undefined && child !== null) element.append(child instanceof Node ? child : String(child));
        }
        return element;
    }
    async function api(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
        let data;
        try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Please try again.'); }
        if (!response.ok) {
            if (response.status === 401 && document.body.dataset.view) location.assign(`/${document.body.dataset.view}/login`);
            throw new Error(data.error || 'Unable to complete this action.');
        }
        return data;
    }
    const send = (url, method, body) => api(url, { method, body: JSON.stringify(body || {}) });
    const button = (label, action, primary = false) => h('button', { type: 'button', class: primary ? 'primary' : '', onclick: action }, label);
    function field(label, control) {
        if (!control.id) control.id = `field-${++field.count}`;
        return h('div', { class: 'field' }, h('label', { for: control.id }, label), control);
    }
    field.count = 0;
    const input = (value = '', type = 'text', attrs = {}) => h('input', { type, value, required: true, ...attrs });
    function select(options, value) {
        const control = h('select', {}, options.map(option => h('option', { value: String(option.value) }, option.label)));
        if (value !== undefined) control.value = String(value);
        return control;
    }
    const panel = (title, ...children) => h('section', { class: 'panel' }, title ? h('h2', {}, title) : null, ...children);
    function table(columns, rows, empty = 'No records found.', { sortable = false } = {}) {
        const body = h('tbody');
        const render = values => {
            body.replaceChildren(...(values.length ? values.map(row => h('tr', {}, row.map(value => h('td', {}, value)))) : [h('tr', {}, h('td', { colspan: columns.length, class: 'empty' }, empty))]));
        };
        let active = -1, descending = false;
        const heads = columns.map((column, index) => {
            const th = h('th', { scope: 'col' });
            if (sortable) th.append(button(column, () => {
                descending = active === index ? !descending : false;
                active = index;
                heads.forEach(head => head.removeAttribute('aria-sort'));
                th.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
                const sorted = [...rows].sort((a, b) => {
                    const av = a[index], bv = b[index];
                    const an = Number(String(av).replace(/[$,]/g, '')), bn = Number(String(bv).replace(/[$,]/g, ''));
                    const compare = String(av).trim() && String(bv).trim() && Number.isFinite(an) && Number.isFinite(bn)
                        ? an - bn : String(av).localeCompare(String(bv), undefined, { numeric: true });
                    return compare * (descending ? -1 : 1);
                });
                render(sorted);
            }));
            else th.append(column);
            th.querySelector('button')?.classList.add('sort-button');
            return th;
        });
        render(rows);
        return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads)), body));
    }
    const metrics = values => h('div', { class: 'metrics' }, values.map(({ label, value }) => h('div', { class: 'metric' }, h('span', {}, label), h('strong', {}, value))));
    function chart({ title, unit, points }) {
        const max = Math.max(...points.map(point => point.value), 1);
        return h('section', { 'aria-label': title }, h('h3', {}, title), h('div', { class: 'chart' }, points.map(point =>
            h('div', { class: 'chart-row' }, h('span', {}, point.label), h('div', { class: 'chart-track' }, h('progress', { max, value: point.value, 'aria-label': `${point.label}: ${numeric(point.value)} ${unit}` })),
                h('span', { class: 'chart-value' }, unit === 'USD' ? money(point.value) : numeric(point.value))))));
    }
    function modal(title, content, footer = []) {
        const dialog = document.getElementById('modal');
        document.getElementById('modal-body').replaceChildren(h('div', { class: 'dialog-header' }, h('h2', { id: 'modal-title' }, title), button('Close', () => dialog.close())), content,
            ...(footer.length ? [h('div', { class: 'dialog-footer' }, footer)] : []));
        if (!dialog.open) dialog.showModal();
        else dialog.querySelector('button, input, select')?.focus();
        return dialog;
    }
    function confirm(title, message, action, label = 'Delete') {
        const error = h('p', { class: 'error', role: 'alert' });
        const submit = button(label, async () => {
            submit.disabled = true;
            try { await action(); document.getElementById('modal').close(); announce('Change saved.'); }
            catch (err) { error.textContent = err.message; }
            finally { submit.disabled = false; }
        }, true);
        modal(title, h('div', { class: 'stack' }, h('p', {}, message), error), [button('Cancel', () => document.getElementById('modal').close()), submit]);
    }
    function announce(message) { const target = document.getElementById('announcement'); if (target) target.textContent = message; }
    document.getElementById('profile')?.addEventListener('click', event => {
        const employee = event.currentTarget.dataset;
        modal('User Profile', h('div', { class: 'stack' }, h('strong', {}, employee.name), h('p', {}, `Role: ${employee.role}`), h('p', {}, `Employee #${employee.employeeId}`)));
    });
    document.getElementById('logout')?.addEventListener('click', () => confirm('Log Out', 'Leave this workspace?', async () => {
        await send('/api/logout', 'POST'); location.assign(`/${document.body.dataset.view}/login`);
    }, 'Log Out'));
    return { h, api, send, button, field, input, select, panel, table, metrics, chart, modal, confirm, announce, money, numeric, dateTime, presetDates };
})();
