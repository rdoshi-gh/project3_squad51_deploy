(() => {
    const { h, api, send, button, field, input, select, table, modal, confirm, announce, money } = POS;
    const grid = document.getElementById('menu-grid'), error = document.getElementById('cashier-message');
    const dialog = document.getElementById('modal');
    let menu = [], order = [], undo = [], redo = [], category = 'All Items', committing = false;
    const snapshot = () => structuredClone(order);
    const find = id => menu.find(item => Number(item.menu_item_id) === Number(id));
    const cents = item => Math.round(Number(item.price) * 100);
    const each = line => cents(find(line.menuItemId)) + line.toppings.reduce((sum, id) => sum + cents(find(id)), 0);
    const total = () => order.reduce((sum, line) => sum + each(line) * line.quantity, 0);
    const options = line => `${line.sweetness}% sweetness · ${line.ice === 'No' ? 'No ice' : `${line.ice} ice`}${line.toppings.length ? ` · ${line.toppings.map(id => find(id).name).join(', ')}` : ''}`;
    function change(action) { undo.push(snapshot()); if (undo.length > 50) undo.shift(); redo = []; action(); drawOrder(); }
    function drawMenu() {
        const search = document.getElementById('menu-search').value.toLowerCase();
        const rows = menu.filter(item => item.category.toLowerCase() !== 'topping' && (category === 'All Items' || item.category === category) && item.name.toLowerCase().includes(search));
        grid.replaceChildren(...(rows.length ? rows.map(item => h('button', { type: 'button', class: 'menu-item', onclick: () => customize(item) }, h('strong', {}, item.name), h('span', {}, money(item.price)))) : [h('p', { class: 'empty' }, 'No matching menu items.')]));
    }
    function drawOrder() {
        const lines = order.map((line, index) => {
            const heading = h('div', { class: 'line-heading' }, h('strong', {}, `${line.quantity} × ${find(line.menuItemId).name}`), h('strong', {}, money(each(line) * line.quantity / 100)));
            const actions = h('div', { class: 'table-actions' }, button('Edit', () => customize(find(line.menuItemId), index)), button('Remove', () => change(() => order.splice(index, 1))));
            return h('div', { class: 'order-line' }, heading, h('p', { class: 'note' }, options(line)), actions);
        });
        document.getElementById('order-lines').replaceChildren(...(lines.length ? lines : [h('p', { class: 'empty' }, 'Select a menu item to start an order.')]));
        document.getElementById('order-total').textContent = money(total() / 100);
        document.getElementById('undo').disabled = !undo.length;
        document.getElementById('redo').disabled = !redo.length;
        document.getElementById('reset-order').disabled = !order.length;
        document.getElementById('checkout').disabled = !order.length;
    }
    function customize(item, index) {
        const existing = index === undefined ? null : order[index];
        const quantity = input(existing?.quantity || 1, 'number', { min: 1, max: 99, step: 1 });
        const sweetness = select([0, 25, 50, 75, 100].map(value => ({ value, label: `${value}%` })), existing?.sweetness ?? 100);
        const ice = select(['No', 'Light', 'Regular', 'Extra'].map(value => ({ value, label: value === 'No' ? 'No ice' : `${value} ice` })), existing?.ice || 'Regular');
        const toppingControls = menu.filter(topping => topping.category.toLowerCase() === 'topping').map(topping => ({ item: topping,
            control: h('input', { type: 'checkbox', value: topping.menu_item_id, checked: existing?.toppings.includes(Number(topping.menu_item_id)) || false }) }));
        const preview = h('strong'), form = h('form');
        const draft = () => ({ menuItemId: Number(item.menu_item_id), quantity: Number(quantity.value), sweetness: Number(sweetness.value), ice: ice.value,
            toppings: toppingControls.filter(row => row.control.checked).map(row => Number(row.item.menu_item_id)) });
        const updatePrice = () => { const line = draft(); preview.textContent = `Item Total: ${money(each(line) * (Number.isFinite(line.quantity) ? line.quantity : 0) / 100)}`; };
        form.append(field('Quantity', quantity), h('div', { class: 'form-row' }, field('Sweetness', sweetness), field('Ice Level', ice)));
        if (toppingControls.length) form.append(h('fieldset', {}, h('legend', {}, 'Toppings'), h('div', { class: 'checkbox-list' }, toppingControls.map(({ item: topping, control }) => h('label', {}, control, `${topping.name} (+${money(topping.price)})`)))));
        const save = h('button', { type: 'submit', class: 'primary' }, existing ? 'Update Item' : 'Add to Order');
        form.append(preview, h('div', { class: 'dialog-footer' }, button('Cancel', () => dialog.close()), save));
        form.addEventListener('input', updatePrice); updatePrice();
        form.addEventListener('submit', event => {
            event.preventDefault(); const line = draft();
            change(() => {
                if (existing) order[index] = line;
                else {
                    const match = order.find(row => row.menuItemId === line.menuItemId && row.ice === line.ice && row.sweetness === line.sweetness && [...row.toppings].sort().join(',') === [...line.toppings].sort().join(',') && row.quantity + line.quantity <= 99);
                    if (match) match.quantity += line.quantity; else order.push(line);
                }
            });
            dialog.close(); announce(`${item.name} ${existing ? 'updated' : 'added'}.`);
        });
        modal(existing ? `Edit ${item.name}` : item.name, form);
    }
    function checkout() {
        const summary = table(['Menu Item', 'Quantity', 'Amount'], order.map(line => [h('div', {}, h('strong', {}, find(line.menuItemId).name), h('p', { class: 'note' }, options(line))), line.quantity, money(each(line) * line.quantity / 100)]));
        const checkoutError = h('p', { class: 'error', role: 'alert' });
        const complete = button('Complete Order', async () => {
            if (committing) return;
            committing = true; complete.disabled = true; back.disabled = true; checkoutError.textContent = '';
            const close = dialog.querySelector('.dialog-header button'); close.disabled = true;
            try {
                const result = await send('/api/orders', 'POST', { lines: order });
                order = []; undo = []; redo = []; drawOrder();
                modal('Order Complete', h('div', { class: 'stack' }, h('h3', {}, `Order #${result.order_id}`), h('p', {}, `Total: ${money(result.total)}`), h('p', {}, 'The order has been recorded and inventory updated.')),
                    [button('Start New Order', () => dialog.close(), true)]);
                announce(`Order ${result.order_id} completed.`);
            } catch (err) { checkoutError.textContent = err.message; }
            finally { committing = false; complete.disabled = false; back.disabled = false; close.disabled = false; }
        }, true);
        const back = button('Back to Order', () => dialog.close());
        modal('Review Order', h('div', { class: 'stack' }, summary, h('div', { class: 'order-total' }, h('span', {}, 'Total'), h('strong', {}, money(total() / 100))), checkoutError), [back, complete]);
    }
    dialog.addEventListener('cancel', event => { if (committing) event.preventDefault(); });
    document.getElementById('menu-search').addEventListener('input', drawMenu);
    document.getElementById('undo').addEventListener('click', () => { if (undo.length) { redo.push(snapshot()); order = undo.pop(); drawOrder(); } });
    document.getElementById('redo').addEventListener('click', () => { if (redo.length) { undo.push(snapshot()); order = redo.pop(); drawOrder(); } });
    document.getElementById('reset-order').addEventListener('click', () => confirm('Reset Order', 'Remove all items from this order?', async () => change(() => { order = []; }), 'Reset Order'));
    document.getElementById('checkout').addEventListener('click', checkout);
    async function load() {
        error.replaceChildren();
        try {
            menu = await api('/api/menu');
            const categories = ['All Items', ...new Set(menu.filter(item => item.category.toLowerCase() !== 'topping').map(item => item.category))];
            const buttons = categories.map(name => {
                const control = button(name, () => { category = name; buttons.forEach(other => other.setAttribute('aria-pressed', String(other === control))); drawMenu(); });
                control.setAttribute('aria-pressed', String(name === category)); return control;
            });
            document.getElementById('categories').replaceChildren(...buttons);
            drawMenu(); drawOrder();
        } catch (err) { error.append(h('p', {}, err.message), button('Try Again', load)); grid.replaceChildren(); }
    }
    drawOrder(); load();
})();
