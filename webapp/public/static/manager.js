(() => {
    const { h, api, send, button, field, input, select, panel, table, metrics, chart, modal, confirm, announce, money, numeric, dateTime } = POS;
    const main = document.getElementById('manager-main');
    let controller = new AbortController(), generation = 0;
    const get = url => api(`/api/manager/${url}`, { signal: controller.signal });
    const write = (url, method, body) => send(`/api/manager/${url}`, method, body);
    const actions = (...buttons) => h('div', { class: 'table-actions' }, buttons);
    const badge = low => h('span', { class: low ? 'badge low' : 'badge' }, low ? 'Low' : 'OK');
    const toolbar = (...controls) => h('div', { class: 'toolbar' }, controls);
    const header = (title, ...controls) => h('header', { class: 'panel page-header' }, h('h1', {}, title), ...controls);
    const status = () => h('p', { class: 'error', role: 'alert' });
    const numberInput = (value, step = '0.01') => input(value, 'number', { min: 0, step, max: 99999999.99 });
    const go = page => { location.hash = page; };

    async function dashboard() {
        const { range, daily, top, low } = await get('dashboard');
        return [header('Dashboard', h('p', {}, `Overview · ${range.start} through ${range.last}`)), panel(null, metrics(daily.metrics)),
            panel('Sales Overview', chart(daily.chart)),
            h('div', { class: 'two-panels' }, panel('Top Selling Items', table(['Menu Item', 'Quantity Sold'], top.map(row => [row.name, numeric(row.quantity)]), 'No orders in this period.')),
                panel('Low Inventory', table(['Inventory Item', 'Quantity', 'Reorder Level'], low.map(row => [row.name, `${numeric(row.quantity)} ${row.unit}`, numeric(row.reorder_level)]), 'All inventory is above reorder levels.')))];
    }

    async function orders() {
        const range = await get('range');
        const start = input(range.start, 'date'), end = input(range.last, 'date');
        const result = h('div', { class: 'stack' }), error = status();
        let pending, request, sequence = 0;
        const pageSignal = controller.signal;
        pageSignal.addEventListener('abort', () => { clearTimeout(pending); request?.abort(); }, { once: true });
        async function load() {
            if (pageSignal.aborted) return;
            request?.abort(); const seq = ++sequence; request = new AbortController();
            if (!start.value || !end.value || start.value > end.value) { error.textContent = 'Choose a valid start date on or before the end date.'; return; }
            error.textContent = ''; result.setAttribute('aria-busy', 'true');
            try {
                const { rows, totals, top } = await api(`/api/manager/orders?${new URLSearchParams({ start: start.value, end: end.value })}`, { signal: request.signal });
                if (seq !== sequence || pageSignal.aborted) return;
                result.replaceChildren(panel(null, metrics([{ label: 'Orders', value: numeric(totals.orders) }, { label: 'Revenue', value: money(totals.revenue) }])),
                    panel('Customer Orders', table(['Order ID', 'Employee', 'Date / Time', 'Total', 'Details'], rows.map(row => [row.order_id, row.employee || `#${row.employee_id}`, dateTime(row.order_timestamp), money(row.total_price),
                        button('View Order', () => orderDetails(row.order_id))]), 'No orders in this date range.'),
                        h('p', { class: 'note' }, rows.length < Number(totals.orders) ? 'Showing the 500 most recent orders. Narrow the dates to see other orders. Times use the database clock.' : 'All orders in the selected period are shown. Times use the database clock.')),
                    panel('Ordering Trends', table(['Top Menu Items', 'Quantity Sold'], top.map(row => [row.name, numeric(row.quantity)]), 'No items sold in this period.')));
            } catch (err) { if (err.name !== 'AbortError') error.textContent = err.message; }
            finally { if (seq === sequence) result.removeAttribute('aria-busy'); }
        }
        for (const control of [start, end]) control.addEventListener('change', () => { request?.abort(); clearTimeout(pending); pending = setTimeout(load, 200); });
        load();
        return [header('Order History & Trends', toolbar(field('Start Date', start), field('End Date', end), button('Refresh', load)), error), result];
    }
    async function orderDetails(orderId) {
        try {
            const { order, items } = await get(`orders/${orderId}`);
            modal(`Order #${orderId}`, h('div', { class: 'stack' }, h('p', {}, `${order.employee || `Employee #${order.employee_id}`} · ${dateTime(order.order_timestamp)}`),
                table(['Menu Item', 'Quantity', 'Current Unit Price'], items.map(row => [row.name, row.quantity, money(row.current_price)])), h('strong', {}, `Recorded order total: ${money(order.total_price)}`),
                h('p', { class: 'note' }, 'Recorded order totals are preserved. Item prices reflect the current menu; historical customizations are not stored in the Project 2 database.')));
        } catch (err) { modal('Unable to Load Order', h('p', { class: 'error', role: 'alert' }, err.message)); }
    }

    const definitions = {
        inventory: { title: 'Inventory Items', singular: 'Inventory Item', search: 'Search Inventory', key: 'inventory_item_id',
            fields: [['name', 'Item Name'], ['quantity', 'System Quantity', 'number'], ['unit', 'Unit'], ['reorder_level', 'Reorder Level', 'number']],
            columns: ['Item', 'System Quantity', 'Unit', 'Reorder Level', 'Status', 'Actions'],
            cells: row => [row.name, numeric(row.quantity), row.unit, numeric(row.reorder_level), badge(Number(row.quantity) <= Number(row.reorder_level))] },
        employees: { title: 'Employee Records', singular: 'Employee', search: 'Search Employee', key: 'employee_id',
            fields: [['name', 'Name'], ['role', 'Role', 'role']], columns: ['Employee ID', 'Name', 'Role', 'Actions'], cells: row => [row.employee_id, row.name, row.role] },
        menu: { title: 'Menu Items', singular: 'Menu Item', search: 'Search Menu', key: 'menu_item_id',
            fields: [['name', 'Item Name'], ['category', 'Category'], ['price', 'Price', 'number']], columns: ['Menu Item ID', 'Name', 'Category', 'Price', 'Actions'], cells: row => [row.menu_item_id, row.name, row.category, money(row.price)] }
    };
    async function records(type) {
        const def = definitions[type];
        const rows = await get(type);
        const search = input('', 'search', { placeholder: def.search, required: false, 'aria-label': def.search });
        const target = h('div');
        const refresh = () => loadPage();
        function draw() {
            const filtered = rows.filter(row => `${row[def.key]} ${row.name} ${row.role || row.category || ''}`.toLowerCase().includes(search.value.toLowerCase()));
            target.replaceChildren(table(def.columns, filtered.map(row => [...def.cells(row), actions(
                button('Edit', () => editRecord(type, row, refresh)),
                ...(type === 'menu' ? [button('Ingredients', () => ingredients(row))] : []),
                button('Delete', () => confirm(`Delete ${def.singular}`, `Delete ${row.name}? Records linked to order or reorder history must be kept.`, async () => { await write(`${type}/${row[def.key]}`, 'DELETE'); await refresh(); }))
            )]), 'No matching records.'));
        }
        search.addEventListener('input', draw); draw();
        return [header(def.title, toolbar(search,
            ...(type === 'inventory' ? [button('Inventory Review / Count', () => go('inventory-review')), button('Create Reorder Request', () => go('restocking'))] : []),
            button(`Add ${def.singular}`, () => editRecord(type, null, refresh), true))), panel(null, target)];
    }
    function editRecord(type, row, refresh) {
        const def = definitions[type], controls = {};
        const form = h('form');
        for (const [key, label, kind] of def.fields) {
            const control = kind === 'role' ? select(['Cashier', 'Manager'].map(value => ({ value, label: value })), row?.[key] || 'Cashier')
                : kind === 'number' ? numberInput(row?.[key] ?? 0) : input(row?.[key] || '', 'text', { maxlength: 150 });
            if (key === 'price') control.max = 9999.99;
            controls[key] = control; form.append(field(label, control));
        }
        const error = status(), save = h('button', { type: 'submit', class: 'primary' }, row ? 'Save Changes' : `Add ${def.singular}`);
        form.append(error, h('div', { class: 'dialog-footer' }, button('Cancel', () => document.getElementById('modal').close()), save));
        form.addEventListener('submit', async event => {
            event.preventDefault(); save.disabled = true; error.textContent = '';
            try {
                const body = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value]));
                await write(`${type}${row ? `/${row[def.key]}` : ''}`, row ? 'PATCH' : 'POST', body);
                document.getElementById('modal').close(); announce('Record saved.'); await refresh();
            } catch (err) { error.textContent = err.message; }
            finally { save.disabled = false; }
        });
        modal(`${row ? 'Edit' : 'Add'} ${def.singular}`, form);
    }

    async function inventoryReview() {
        const rows = await get('inventory');
        const choose = select([{ value: '', label: 'Select inventory item' }, ...rows.map(row => ({ value: row.inventory_item_id, label: row.name }))]);
        const system = input('—', 'text', { disabled: true, required: false }), count = numberInput('');
        const countError = status(), reviewError = status(), support = h('div', { class: 'stack' });
        const current = input('—', 'text', { disabled: true, required: false }), suggested = numberInput('');
        const update = h('button', { type: 'submit', class: 'primary', disabled: true }, 'Update Count');
        const apply = h('button', { type: 'submit', class: 'primary', disabled: true }, 'Apply New Reorder Level');
        let selected, sequence = 0;
        async function load() {
            const seq = ++sequence; selected = null; update.disabled = true; apply.disabled = true;
            countError.textContent = ''; reviewError.textContent = ''; support.replaceChildren(); system.value = '—'; current.value = '—'; count.value = ''; suggested.value = '';
            if (!choose.value) return;
            try {
                const data = await get(`inventory/${choose.value}/review`);
                if (seq !== sequence) return;
                selected = data.item; system.value = `${numeric(selected.quantity)} ${selected.unit}`;
                current.value = `${numeric(selected.reorder_level)} ${selected.unit}`;
                suggested.value = data.suggested;
                support.replaceChildren(panel('Recent Order Usage', metrics([{ label: 'Last 7 days of order history', value: `${numeric(data.week)} ${selected.unit}` }, { label: 'Average weekly usage (4 weeks)', value: `${numeric(data.average)} ${selected.unit}` }]),
                    h('p', { class: 'note' }, 'Suggested reorder level is average weekly usage rounded up. Review this estimate alongside previous requests before applying it.')),
                    panel('Previous Requests', table(['Quantity Requested', 'Request Date / Time'], data.requests.map(row => [`${numeric(row.quantity_requested)} ${selected.unit}`, dateTime(row.request_date_time)]), 'No previous requests for this item.')));
                update.disabled = false; apply.disabled = false;
            } catch (err) { if (err.name !== 'AbortError') countError.textContent = err.message; }
        }
        choose.addEventListener('change', load);
        const countForm = h('form', {}, h('div', { class: 'count-row' }, field('Inventory Item', choose), field('System Quantity', system), field('Physical Count', count), update), countError);
        countForm.addEventListener('submit', async event => {
            event.preventDefault(); if (!selected) return; update.disabled = true;
            try { await write(`inventory/${selected.inventory_item_id}/count`, 'PATCH', { value: count.value }); await load(); countError.className = 'success'; countError.textContent = 'Physical inventory count updated.'; announce(countError.textContent); }
            catch (err) { countError.className = 'error'; countError.textContent = err.message; }
            finally { update.disabled = !selected; }
        });
        const reviewForm = h('form', {}, h('div', { class: 'count-row' }, field('Current Reorder Level', current), field('Suggested Reorder Level', suggested), apply), reviewError);
        reviewForm.addEventListener('submit', async event => {
            event.preventDefault(); if (!selected) return; apply.disabled = true;
            try { await write(`inventory/${selected.inventory_item_id}/reorder-level`, 'PATCH', { value: suggested.value }); await load(); reviewError.className = 'success'; reviewError.textContent = 'Reorder level updated.'; announce(reviewError.textContent); }
            catch (err) { reviewError.className = 'error'; reviewError.textContent = err.message; }
            finally { apply.disabled = !selected; }
        });
        return [header('Inventory Review', button('Back to Inventory', () => go('inventory'))), panel('Physical Inventory Count', countForm), panel('Reorder Level Review', reviewForm), support];
    }

    async function restocking() {
        const [items, requests] = await Promise.all([get('inventory'), get('reorders')]);
        const choose = select([{ value: '', label: 'Select inventory item' }, ...items.map(row => ({ value: row.inventory_item_id, label: row.name }))]);
        const current = input('—', 'text', { disabled: true, required: false }), quantity = numberInput(''); quantity.min = '0.01';
        choose.addEventListener('change', () => { const row = items.find(item => String(item.inventory_item_id) === choose.value); current.value = row ? `${numeric(row.quantity)} ${row.unit}` : '—'; });
        const error = status(), submit = h('button', { type: 'submit', class: 'primary' }, 'Create Reorder Request');
        const form = h('form', { class: 'stack' }, h('div', { class: 'count-row' }, field('Inventory Item', choose), field('Current Quantity', current), field('Quantity Requested', quantity), submit), error);
        form.addEventListener('submit', async event => {
            event.preventDefault(); submit.disabled = true; error.textContent = '';
            try { await write('reorders', 'POST', { inventory_item_id: choose.value, quantity_requested: quantity.value }); announce('Reorder request created.'); await loadPage(); }
            catch (err) { error.textContent = err.message; }
            finally { submit.disabled = false; }
        });
        return [header('Restocking'), panel('Create Reorder Request', form, h('p', { class: 'note' }, 'Creating a request records the supply order. Update inventory after receiving and counting the items.')),
            panel('Reorder Requests', table(['Inventory Item', 'Quantity Requested', 'Request Date / Time'], requests.map(row => [row.name, `${numeric(row.quantity_requested)} ${row.unit}`, dateTime(row.request_date_time)]), 'No reorder requests.'), h('p', { class: 'note' }, 'Showing the 100 most recent requests.'))];
    }

    async function ingredients(item) {
        try {
            const [rows, inventory] = await Promise.all([get(`menu/${item.menu_item_id}/ingredients`), get('inventory')]);
            const available = inventory.filter(row => !rows.some(recipe => recipe.inventory_item_id === row.inventory_item_id));
            const choose = select([{ value: '', label: 'Select ingredient' }, ...available.map(row => ({ value: row.inventory_item_id, label: `${row.name} (${row.unit})` }))]);
            const quantity = numberInput('', '0.0001'); quantity.min = '0.0001'; quantity.max = '999999.9999';
            const error = status(), submit = h('button', { type: 'submit', class: 'primary', disabled: !available.length }, 'Add Ingredient');
            const form = h('form', {}, h('div', { class: 'form-row' }, field('Inventory Item', choose), field('Quantity Required per Menu Item', quantity)), error, submit);
            form.addEventListener('submit', async event => {
                event.preventDefault(); submit.disabled = true;
                try { await write(`menu/${item.menu_item_id}/ingredients`, 'POST', { inventory_item_id: choose.value, quantity_required: quantity.value }); announce('Ingredient added.'); await ingredients(item); }
                catch (err) { error.textContent = err.message; submit.disabled = false; }
            });
            modal(`Ingredients · ${item.name}`, h('div', { class: 'stack' }, table(['Inventory Item', 'Quantity Required', 'Unit', 'Action'], rows.map(row => [row.name, numeric(row.quantity_required), row.unit,
                button('Remove', async () => {
                    try { await write(`menu/${item.menu_item_id}/ingredients/${row.inventory_item_id}`, 'DELETE'); announce('Ingredient removed.'); await ingredients(item); }
                    catch (err) { error.textContent = err.message; }
                })]), 'No ingredients assigned.'), form));
        } catch (err) { modal('Unable to Load Ingredients', h('p', { class: 'error', role: 'alert' }, err.message)); }
    }

    async function reporting(usageOnly = false) {
        const range = await get('range');
        const options = [{ value: 'daily', label: 'Daily Sales Summary' }, { value: 'top', label: 'Top Selling Items' }, { value: 'inventory', label: 'Inventory Status' }, { value: 'hourly', label: 'X Report (Hourly Sales)' }, { value: 'sales', label: 'Sales Report' }, { value: 'restock', label: 'Restock Report' }];
        const type = select(options, 'daily'), start = input(range.start, 'date'), end = input(range.last, 'date');
        const result = h('div', { class: 'stack' }), error = status();
        let pending, request, sequence = 0;
        const pageSignal = controller.signal;
        pageSignal.addEventListener('abort', () => { clearTimeout(pending); request?.abort(); }, { once: true });
        async function load() {
            clearTimeout(pending);
            if (pageSignal.aborted) return;
            const reportType = usageOnly ? 'usage' : type.value;
            const historical = ['daily', 'top', 'sales', 'usage'].includes(reportType);
            start.disabled = end.disabled = !historical;
            request?.abort(); const seq = ++sequence; request = new AbortController();
            error.textContent = '';
            if (historical && (!start.value || !end.value || start.value > end.value)) { error.textContent = 'Choose a valid start date on or before the end date.'; return; }
            result.setAttribute('aria-busy', 'true');
            try {
                const data = await api(`/api/manager/reports?${new URLSearchParams({ type: reportType, start: start.value, end: end.value })}`, { signal: request.signal });
                if (seq !== sequence || pageSignal.aborted) return;
                result.replaceChildren(panel(data.title, table(data.columns, data.rows, data.empty, { sortable: true })),
                    ...(data.chart ? [panel(null, chart(data.chart))] : []),
                    ...(data.groups || []).map(group => panel(null, chart(group))),
                    panel(null, metrics(data.metrics), h('p', { class: 'note' }, data.note)));
                announce(`${data.title} loaded.`);
            } catch (err) { if (err.name !== 'AbortError') error.textContent = err.message; }
            finally { if (seq === sequence) result.removeAttribute('aria-busy'); }
        }
        for (const control of [type, start, end]) control.addEventListener('change', () => { request?.abort(); clearTimeout(pending); pending = setTimeout(load, 250); });
        const shortcuts = usageOnly ? toolbar(...[['Last 7 Days', 7], ['Last 30 Days', 30], ['All Time', null]].map(([label, days]) => button(label, () => {
            const dates = POS.presetDates(range, days); start.value = dates.start; end.value = dates.end; load();
        }))) : null;
        load();
        return [header(usageOnly ? 'Product Usage' : 'Reports', toolbar(...(!usageOnly ? [field('Report Type', type)] : []), field('Start Date', start), field('End Date', end), button('Refresh Report', load)), ...(shortcuts ? [h('div', { class: 'note' }, shortcuts)] : []), error), result];
    }

    const builders = { dashboard, orders, inventory: () => records('inventory'), 'inventory-review': inventoryReview, usage: () => reporting(true), restocking, employees: () => records('employees'), menu: () => records('menu'), reports: () => reporting() };
    async function loadPage() {
        controller.abort(); controller = new AbortController(); const current = ++generation;
        const page = location.hash.slice(1) || 'dashboard';
        document.querySelectorAll('#manager-nav a').forEach(link => {
            const selected = link.dataset.page === (page === 'inventory-review' ? 'inventory' : page);
            if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        main.setAttribute('aria-busy', 'true'); main.replaceChildren(panel(null, h('p', { role: 'status' }, 'Loading…')));
        try {
            const content = await (builders[page] || builders.dashboard)();
            if (current !== generation) return;
            main.replaceChildren(...content); document.title = `${page === 'inventory-review' ? 'Inventory Review' : main.querySelector('h1')?.textContent || 'Manager'} · Popping POS`;
        } catch (err) {
            if (err.name !== 'AbortError' && current === generation) main.replaceChildren(panel('Unable to Load Page', h('p', { class: 'error', role: 'alert' }, err.message), button('Try Again', loadPage)));
        } finally { if (current === generation) main.removeAttribute('aria-busy'); }
    }
    window.addEventListener('hashchange', loadPage);
    loadPage();
})();
