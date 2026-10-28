(() => {
    const grid = document.getElementById('kiosk-menu-grid');
    const message = document.getElementById('kiosk-message');
    const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
    const make = (tag, attrs = {}, ...children) => {
        const node = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else if (key === 'class') node.className = value;
            else if (value !== undefined && value !== null) node.setAttribute(key, value);
        });
        children.flat().filter(child => child !== null && child !== undefined).forEach(child => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
        return node;
    };
    async function loadMenu() {
        try {
            const response = await fetch('/api/kiosk/menu');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'We could not load the menu.');
            const drinks = data.filter(item => String(item.category).toLowerCase() !== 'topping');
            grid.replaceChildren(...drinks.map(item => make('article', { class: 'kiosk-drink-card' }, make('h3', {}, item.name), make('p', {}, item.category), make('strong', {}, money(item.price)))));
            if (!drinks.length) grid.replaceChildren(make('p', { class: 'kiosk-empty' }, 'Our menu is taking a little break. Please check back soon.'));
        } catch (error) {
            message.textContent = error.message;
            grid.replaceChildren(make('button', { type: 'button', class: 'kiosk-retry', onclick: loadMenu }, 'Try again'));
        }
    }
    loadMenu();
})();
