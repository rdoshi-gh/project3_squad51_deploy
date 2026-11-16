const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const employee = { employeeId: 1, name: 'Private Employee', role: 'Manager' };
const menu = [{ menu_item_id: 1, name: 'New Guava Tea', category: 'Tea', price: '5.50' }];
const range = { first: '2026-11-01', start: '2026-11-09', last: '2026-11-15' };
const locals = { employee, view: 'manager', message: 'Page not found.', teammembers: [{ first_name: 'Private', last_name: 'Employee' }], customer: null, googleEnabled: false, signinError: '' };
const json = data => ({ ok: true, status: 200, json: async () => data });
async function waitFor(check) {
    for (let i = 0; i < 200; i++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for accessibility page state');
}

async function openPage(t, view, { hash = '', language = 'es', role = 'manager' } = {}) {
    const html = await ejs.renderFile(path.join(__dirname, `../views/${view}.ejs`), { ...locals, view: role });
    const dom = new JSDOM(html, { url: `http://localhost/${view}${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, d = w.document, batches = [], requests = [], observers = [];
    const Observer = w.MutationObserver;
    w.MutationObserver = class extends Observer { constructor(callback) { super(callback); observers.push(this); } };
    t.after(async () => { await new Promise(resolve => setImmediate(resolve)); observers.forEach(observer => observer.disconnect()); w.close(); });
    w.TextEncoder = TextEncoder;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    w.localStorage.setItem('pos-accessibility-settings', JSON.stringify({ language, textScale: 1.5, controlScale: 1.5, highContrast: true, readableSpacing: true }));
    let completed = false;
    w.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (url === '/api/translate') {
            const { texts } = JSON.parse(options.body); batches.push(...texts);
            return json({ translations: texts.map(text => `ES ${text}`) });
        }
        if (url.startsWith('/api/login-employees')) return json([{ employee_id: 1, name: employee.name, role: 'Manager' }]);
        if (url === '/api/menu' || url === '/api/kiosk/menu') return json(menu);
        if (url === '/api/manager/range') return json(range);
        if (url === '/api/manager/employees') return json([{ employee_id: 1, name: employee.name, role: 'Manager' }]);
        if (url.startsWith('/api/manager/orders?')) return json({ rows: [{ order_id: 42, employee: employee.name, employee_id: 1, order_timestamp: '2026-11-15T12:00:00', total_price: '5.50' }], totals: { orders: 1, revenue: '5.50' }, top: [{ name: menu[0].name, quantity: 1 }] });
        if (url === '/api/manager/orders/42') return json({ order: { employee: employee.name, total_price: '5.50' }, items: [{ name: menu[0].name, quantity: 1, current_price: '5.50' }] });
        if (url === '/api/kitchen/orders/42/ready') { completed = true; return json({ order_id: 42 }); }
        if (url === '/api/kitchen/orders') {
            const order = { order_id: 42, order_timestamp: '2026-11-15T12:00:00', items: [{ name: menu[0].name, quantity: 1, category: 'Tea' }] };
            return json({ inProgress: completed ? [] : [order], ready: completed ? [order] : [] });
        }
        throw new Error(`Unexpected test request ${url}`);
    };
    for (const script of d.querySelectorAll('script[src]')) w.eval(readFileSync(path.join(__dirname, '../public/static', path.basename(script.src)), 'utf8'));
    return { w, d, batches, requests, changeLanguage(value) {
        d.getElementById('accessibility-language').value = value;
        d.getElementById('accessibility-language').dispatchEvent(new w.Event('change'));
    } };
}

for (const view of ['index', 'login', 'cashier', 'manager', 'kitchen', 'kitchen-login', 'kiosk', 'leaderboard', 'error', 'user']) {
    test(`${view} renders exactly one accessibility menu and shared translation feedback`, async () => {
        const html = await ejs.renderFile(path.join(__dirname, `../views/${view}.ejs`), locals);
        const dom = new JSDOM(html);
        try {
            const d = dom.window.document;
            for (const id of ['accessibility-toggle', 'accessibility-panel', 'accessibility-language', 'translation-feedback']) {
                assert.equal(d.querySelectorAll(`#${id}`).length, 1, `${view}: ${id}`);
            }
            assert.ok(d.querySelector('link[href="/static/accessibility.css"]'));
            assert.ok(d.querySelector('script[src="/static/translation.js"]'));
            if (view.startsWith('kitchen')) {
                assert.ok(d.querySelector('link[href="/static/kitchen.css"]'));
                assert.equal(d.querySelector('link[href="/static/style.css"]'), null);
            }
        } finally { dom.window.close(); }
    });
}

for (const [view, options] of [['index', {}], ['login', { role: 'cashier' }], ['kitchen-login', {}], ['cashier', {}], ['manager', { hash: '#orders' }], ['kitchen', {}]]) {
    test(`${view} restores all saved preferences and translates dynamic content without translating employee names`, async t => {
        const ui = await openPage(t, view, options);
        await waitFor(() => ui.batches.length && ui.d.getElementById('translation-feedback').hidden);
        assert.equal(ui.d.documentElement.lang, 'es');
        assert.equal(ui.d.body.style.getPropertyValue('--accessibility-text-scale'), '1.5');
        assert.equal(ui.d.body.style.getPropertyValue('--accessibility-control-scale'), '1.5');
        assert.ok(ui.d.body.classList.contains('accessibility-high-contrast'));
        assert.ok(ui.d.body.classList.contains('accessibility-readable-spacing'));
        assert.ok(ui.d.getElementById('accessibility-high-contrast').checked);
        assert.ok(!ui.batches.some(text => text.includes(employee.name)));
        if (view === 'manager') assert.match(ui.d.getElementById('manager-main').textContent, /Pedidos de clientes/);
        if (view === 'kitchen') assert.match(ui.d.getElementById('in-progress-orders').textContent, /ES New Guava Tea/);
        const employeeSelect = ui.d.querySelector('#employee, #kitchen-employee');
        if (employeeSelect) {
            employeeSelect.value = '1';
            assert.match(employeeSelect.options[1].textContent, /Gerente/);
        }
        ui.changeLanguage('en');
        assert.equal(ui.d.documentElement.lang, 'en');
        assert.ok(ui.d.getElementById('translation-feedback').hidden);
        if (employeeSelect) {
            assert.equal(employeeSelect.value, '1');
            assert.match(employeeSelect.options[1].textContent, /Manager/);
        }
    });
}

test('manager order details and employee CRUD dialogs preserve names, form values, and page navigation', async t => {
    const ui = await openPage(t, 'manager', { hash: '#orders' });
    await waitFor(() => [...ui.d.querySelectorAll('button')].some(button => button.textContent === 'Ver pedido'));
    [...ui.d.querySelectorAll('button')].find(button => button.textContent === 'Ver pedido').click();
    await waitFor(() => ui.d.getElementById('modal-title')?.textContent === 'ES Order #42');
    assert.ok(ui.d.getElementById('modal').textContent.includes(employee.name));
    ui.d.getElementById('modal').close();
    ui.w.location.hash = 'employees';
    await waitFor(() => ui.d.querySelector('#manager-main h1')?.textContent === 'Registros de empleados');
    // The title is assembled dynamically by manager navigation and translated
    // as a whole rather than being copied from the already-translated heading.
    await waitFor(() => ui.d.title.startsWith('ES Employee Records'));
    [...ui.d.querySelectorAll('button')].find(button => button.textContent === 'Editar').click();
    await waitFor(() => ui.d.querySelector('#modal form input'));
    assert.equal(ui.d.querySelector('#modal form input').value, employee.name);
    assert.equal(ui.d.querySelector('#modal form select').value, 'Manager');
    ui.changeLanguage('en');
    assert.equal(ui.d.querySelector('#modal form input').value, employee.name);
    assert.ok(!ui.batches.some(text => text.includes(employee.name)));
});

test('translated kitchen action still sends the original order ID and applies settings to new ready cards', async t => {
    const ui = await openPage(t, 'kitchen');
    await waitFor(() => ui.d.querySelector('.mark-ready')?.textContent.startsWith('ES '));
    ui.d.querySelector('.mark-ready').click();
    await waitFor(() => ui.d.querySelector('#ready-orders .order-card')?.textContent.includes('ES New Guava Tea'));
    assert.ok(ui.requests.some(request => request.url === '/api/kitchen/orders/42/ready' && request.options.method === 'PATCH'));
    assert.ok(ui.d.querySelector('#ready-orders h3').dataset.accessibilityBaseFontSize !== undefined);
});

test('unchanged kitchen polling keeps the same translated card and keyboard focus', async t => {
    const ui = await openPage(t, 'kitchen');
    await waitFor(() => ui.d.querySelector('.mark-ready')?.textContent.startsWith('ES '));
    const button = ui.d.querySelector('.mark-ready');
    button.focus();
    const before = ui.requests.filter(request => request.url === '/api/kitchen/orders').length;
    ui.d.getElementById('refresh-button').click();
    await waitFor(() => ui.requests.filter(request => request.url === '/api/kitchen/orders').length > before);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.d.querySelector('.mark-ready'), button);
    assert.equal(ui.d.activeElement, button);
});

test('cashier menu translation preserves the focused menu button', async t => {
    const ui = await openPage(t, 'cashier');
    await waitFor(() => ui.d.querySelector('.menu-item'));
    const button = ui.d.querySelector('.menu-item');
    button.focus();
    await waitFor(() => button.textContent.includes('ES New Guava Tea'));
    assert.equal(ui.d.querySelector('.menu-item'), button);
    assert.equal(ui.d.activeElement, button);
});
