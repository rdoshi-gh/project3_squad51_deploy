(() => {
    const grid = document.getElementById('kiosk-menu-grid');
    const message = document.getElementById('kiosk-message');
    const categoriesHost = document.getElementById('kiosk-categories');
    const search = document.getElementById('kiosk-search');
    const dialog = document.getElementById('kiosk-dialog');
    const dialogBody = document.getElementById('kiosk-dialog-body');
    const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
    const make = (tag, attrs = {}, ...children) => {
        const node = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
            else if (key === 'class') node.className = value;
            else if (key === 'value' || key === 'checked' || key === 'disabled') node[key] = value;
            else if (value !== undefined && value !== null) node.setAttribute(key, value);
        });
        children.flat().filter(child => child !== null && child !== undefined).forEach(child => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
        return node;
    };
    const button = (label, action, primary = false) => make('button', { type: 'button', class: primary ? 'kiosk-primary' : 'kiosk-secondary', onclick: action }, label);
    let menu = [], cart = [], activeCategory = 'All drinks', busy = false;
    const findItem = id => menu.find(item => Number(item.menu_item_id) === Number(id));
    const isTopping = item => String(item.category).toLowerCase() === 'topping';
    const drinks = () => menu.filter(item => !isTopping(item));
    const cents = item => Math.round(Number(item.price) * 100);
    const lineCents = line => cents(findItem(line.menuItemId)) + line.toppings.reduce((sum, id) => sum + cents(findItem(id)), 0);
    const cartCents = () => cart.reduce((sum, line) => sum + lineCents(line) * line.quantity, 0);
    const drinkArt = item => {
        const category = String(item.category).toLowerCase();
        if (category.includes('fruit') || /mango|strawberry|peach|lychee|passion/i.test(item.name)) return '🍓';
        if (category.includes('coffee') || /coffee|espresso|mocha/i.test(item.name)) return '🧋';
        if (category.includes('matcha') || /matcha|green tea/i.test(item.name)) return '🍵';
        if (/lemon|tea|jasmine|oolong/i.test(item.name)) return '🍃';
        return '🥤';
    };
    const optionsText = line => `${line.sweetness}% sweetness · ${line.ice === 'No' ? 'No ice' : `${line.ice} ice`}${line.toppings.length ? ` · ${line.toppings.map(id => findItem(id)?.name).filter(Boolean).join(', ')}` : ''}`;
    function announce(text) { document.getElementById('kiosk-announcement').textContent = text; }
    function showDialog(title, content) {
        dialogBody.replaceChildren(make('h2', { id: 'kiosk-dialog-title' }, title), content);
        if (!dialog.open) dialog.showModal();
    }
    function drawCategories() {
        const names = ['All drinks', ...new Set(drinks().map(item => item.category))];
        categoriesHost.replaceChildren(...names.map(name => {
            const control = make('button', { type: 'button', 'aria-pressed': String(name === activeCategory), onclick: () => {
                activeCategory = name;
                drawCategories();
                drawMenu();
            } }, name);
            return control;
        }));
    }
    function drawMenu() {
        const query = search.value.trim().toLowerCase();
        const rows = drinks().filter(item => (activeCategory === 'All drinks' || item.category === activeCategory) && `${item.name} ${item.category}`.toLowerCase().includes(query));
        grid.replaceChildren(...(rows.length ? rows.map((item, index) => {
            const art = make('div', { class: 'kiosk-drink-art', 'data-tone': String(index % 5), 'aria-hidden': 'true' }, drinkArt(item));
            const add = make('button', { type: 'button', class: 'kiosk-add-drink', 'aria-label': `Customize ${item.name}, ${money(item.price)}`, onclick: () => customize(item) }, '+');
            return make('article', { class: 'kiosk-drink-card' }, art, make('p', {}, item.category), make('h3', {}, item.name), make('div', { class: 'kiosk-card-bottom' }, make('strong', { class: 'kiosk-price' }, money(item.price)), add));
        }) : [make('p', { class: 'kiosk-empty' }, 'No drinks match that search. Try another name or category.') ]));
    }
    function drawCartSummary() {
        const count = cart.reduce((sum, line) => sum + line.quantity, 0);
        document.getElementById('kiosk-cart-count').textContent = count;
        document.getElementById('kiosk-cart-total').textContent = money(cartCents() / 100);
        document.getElementById('kiosk-cart-label').textContent = count ? `${count} ${count === 1 ? 'drink' : 'drinks'} in your order` : 'Your order is waiting';
        document.getElementById('kiosk-cart-hint').textContent = count ? 'Looking good. Ready when you are.' : 'Add a drink to get started';
        document.getElementById('kiosk-review').disabled = !count || busy;
    }
    function customize(item, editIndex = -1) {
        const existing = editIndex >= 0 ? cart[editIndex] : null;
        const quantity = make('input', { type: 'number', min: '1', max: '99', step: '1', required: '', value: existing?.quantity || 1, 'aria-label': 'Quantity' });
        const sweetness = make('select', { 'aria-label': 'Sweetness level' }, [0, 25, 50, 75, 100].map(value => make('option', { value, selected: String(value) === String(existing?.sweetness ?? 100) }, `${value}%`)));
        const ice = make('select', { 'aria-label': 'Ice level' }, ['No', 'Light', 'Regular', 'Extra'].map(value => make('option', { value, selected: value === (existing?.ice || 'Regular') }, value === 'No' ? 'No ice' : `${value} ice`)));
        const toppingItems = menu.filter(isTopping);
        const toppingControls = toppingItems.map(topping => {
            const check = make('input', { type: 'checkbox', value: topping.menu_item_id, checked: existing?.toppings.includes(Number(topping.menu_item_id)) || false });
            return { topping, check };
        });
        const price = make('strong', {}, '');
        const form = make('form', { class: 'kiosk-form-stack' });
        const field = (label, control) => make('div', { class: 'kiosk-form-field' }, make('label', {}, label), control);
        form.append(field('How many?', quantity), field('Sweetness', sweetness), field('Ice level', ice));
        if (toppingControls.length) form.append(make('fieldset', {}, make('legend', {}, 'Make it extra special'), make('div', { class: 'kiosk-topping-options' }, toppingControls.map(({ topping, check }) => make('label', {}, check, `${topping.name} (+${money(topping.price)})`)))));
        const preview = () => {
            const total = cents(item) + toppingControls.filter(row => row.check.checked).reduce((sum, row) => sum + cents(row.topping), 0);
            price.textContent = `Item subtotal: ${money(total * Math.max(1, Number(quantity.value) || 1) / 100)}`;
        };
        form.append(price);
        const actions = make('div', { class: 'kiosk-dialog-actions' }, button('Cancel', () => dialog.close()), make('button', { type: 'submit', class: 'kiosk-primary' }, existing ? 'Save changes' : 'Add to order'));
        form.append(actions);
        form.addEventListener('input', preview);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const count = Number(quantity.value);
            if (!Number.isInteger(count) || count < 1 || count > 99) { quantity.focus(); return; }
            const line = { menuItemId: Number(item.menu_item_id), quantity: count, sweetness: Number(sweetness.value), ice: ice.value, toppings: toppingControls.filter(row => row.check.checked).map(row => Number(row.topping.menu_item_id)) };
            if (existing) cart[editIndex] = line;
            else {
                const match = cart.find(row => row.menuItemId === line.menuItemId && row.ice === line.ice && row.sweetness === line.sweetness && [...row.toppings].sort().join(',') === [...line.toppings].sort().join(',') && row.quantity + line.quantity <= 99);
                if (match) match.quantity += line.quantity; else cart.push(line);
            }
            dialog.close(); drawCartSummary(); announce(`${item.name} added to your order.`);
        });
        preview();
        showDialog(existing ? `Customize ${item.name}` : `Make it yours: ${item.name}`, form);
    }
    function reviewCart() {
        const list = make('div', { class: 'kiosk-review-lines' });
        const renderLines = () => {
            list.replaceChildren(...(cart.length ? cart.map((line, index) => {
                const item = findItem(line.menuItemId);
                const details = make('div', {},
                    make('strong', {}, `${line.quantity} × ${item.name}`),
                    make('p', {}, optionsText(line)),
                    make('div', { class: 'kiosk-line-actions' },
                        button('Edit', () => customize(item, index)),
                        button('Remove', () => { cart.splice(index, 1); drawCartSummary(); renderLines(); })
                    )
                );
                return make('div', { class: 'kiosk-cart-line' }, details, make('strong', {}, money(lineCents(line) * line.quantity / 100)));
            }) : [make('p', { class: 'kiosk-empty' }, 'Your order is empty. Add a drink to continue.') ]));
            total.textContent = money(cartCents() / 100);
            place.disabled = !cart.length || busy;
        };
        const total = make('strong', {}, money(cartCents() / 100));
        const error = make('p', { class: 'kiosk-message', role: 'alert' });
        const place = make('button', { type: 'button', class: 'kiosk-primary', onclick: () => placeOrder(error, place), disabled: busy }, 'Place order');
        const content = make('div', { class: 'kiosk-form-stack' }, list, error, make('div', { class: 'kiosk-grand-total' }, make('span', {}, 'Order total'), total), make('div', { class: 'kiosk-dialog-actions' }, button('Keep browsing', () => dialog.close()), place));
        renderLines(); showDialog('One last look', content);
    }
    async function placeOrder(error, submit) {
        // The order endpoint is added in the database integration commit.
        if (busy) return;
        busy = true; submit.disabled = true; drawCartSummary(); error.textContent = '';
        try {
            const response = await fetch('/api/kiosk/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: cart }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'We could not place your order. Please try again.');
            cart = []; drawCartSummary();
            const confirmation = make('div', { class: 'kiosk-form-stack' }, make('p', {}, 'Thank you! Your order has been sent to our team.'), make('div', { class: 'kiosk-grand-total' }, make('span', {}, `Order #${result.order_id}`), make('strong', {}, money(result.total))), make('div', { class: 'kiosk-dialog-actions' }, button('Start a new order', () => { dialog.close(); drawCartSummary(); document.getElementById('kiosk-menu').scrollIntoView({ behavior: 'smooth' }); }, true)));
            showDialog('You made a good choice!', confirmation); announce(`Order ${result.order_id} placed successfully.`);
        } catch (err) { error.textContent = err.message; }
        finally { busy = false; drawCartSummary(); }
    }
    document.getElementById('kiosk-review').addEventListener('click', reviewCart);
    search.addEventListener('input', drawMenu);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    async function loadMenu() {
        message.textContent = '';
        grid.replaceChildren(make('p', { class: 'kiosk-empty' }, 'Getting the good stuff ready…'));
        try {
            const response = await fetch('/api/kiosk/menu');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'We could not load the menu.');
            menu = data;
            drawCategories(); drawMenu(); drawCartSummary();
            if (!drinks().length) grid.replaceChildren(make('p', { class: 'kiosk-empty' }, 'Our menu is taking a little break. Please check back soon.'));
        } catch (error) {
            message.textContent = error.message;
            grid.replaceChildren(button('Try again', loadMenu));
        }
    }
    drawCartSummary();
    loadMenu();
})();
