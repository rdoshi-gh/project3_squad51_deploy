const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUi, flush, response } = require('./helpers/ui');

for (const [page, singular, row] of [
    ['employees', 'Employee', { employee_id: 2, name: 'Test Cashier', role: 'Cashier' }],
    ['inventory', 'Inventory Item', { inventory_item_id: 1, name: 'Milk', quantity: 20, unit: 'gallons', reorder_level: 10 }],
    ['menu', 'Menu Item', { menu_item_id: 1, name: 'Milk Tea', category: 'Tea', price: 5.25 }]
]) {
    for (const edit of [false, true]) {
        test(`${edit ? 'edit' : 'add'} ${singular} keeps Cancel without a duplicate Close button`, async t => {
            const ui = await createUi({ view: 'manager', page, fetch: async url => {
                assert.equal(url, `/api/manager/${page}`);
                return response([row]);
            } });
            t.after(() => ui.dom.window.close());
            ui.run('manager'); await flush();
            ui.findButton(edit ? 'Edit' : `Add ${singular}`, ui.document).click();
            assert.equal(ui.dialog.open, true);
            assert.deepEqual([...ui.dialog.querySelectorAll('button')].map(control => control.textContent), ['Cancel', edit ? 'Save Changes' : `Add ${singular}`]);
            ui.findButton('Cancel').click();
            assert.equal(ui.dialog.open, false);
            assert.equal(ui.requests.length, 1, 'cancelling does not save changes');
        });
    }
}

const menu = [{ menu_item_id: 1, name: 'Milk Tea', category: 'Tea', price: '5.25' }];
async function beginOrder(ui) {
    ui.run('cashier'); await flush();
    ui.document.querySelector('.menu-item').click();
    assert.equal(ui.dialog.open, true);
    assert.deepEqual([...ui.dialog.querySelectorAll('button')].map(control => control.textContent), ['Cancel', 'Add to Order']);
    ui.findButton('Add to Order').click();
    assert.equal(ui.dialog.open, false);
    ui.document.getElementById('checkout').click();
    assert.deepEqual([...ui.dialog.querySelectorAll('button')].map(control => control.textContent), ['Back to Order', 'Complete Order']);
}

test('cashier dialogs keep one dismiss action and checkout can recover from a failed request', async t => {
    let attempts = 0;
    const ui = await createUi({ fetch: async url => url === '/api/menu' ? response(menu) : ++attempts === 1
        ? response({ error: 'Not enough inventory.' }, 409) : response({ order_id: 9, total: 5.25 }, 201) });
    t.after(() => ui.dom.window.close());
    await beginOrder(ui);
    ui.findButton('Complete Order').click(); await flush();
    assert.match(ui.dialog.textContent, /Not enough inventory/);
    assert.equal(ui.findButton('Complete Order').disabled, false);
    assert.equal(ui.findButton('Back to Order').disabled, false);
    ui.findButton('Complete Order').click(); await flush();
    assert.match(ui.dialog.textContent, /Order Complete/);
    assert.deepEqual([...ui.dialog.querySelectorAll('button')].map(control => control.textContent), ['Start New Order']);
    ui.findButton('Start New Order').click();
    assert.equal(ui.dialog.open, false);
});

test('checkout stays open and prevents duplicate submissions while the request is pending', async t => {
    let finish;
    const ui = await createUi({ fetch: async url => url === '/api/menu' ? response(menu) : new Promise(resolve => { finish = resolve; }) });
    t.after(() => ui.dom.window.close());
    await beginOrder(ui);
    ui.findButton('Complete Order').click(); await flush();
    assert.equal(ui.findButton('Complete Order').disabled, true);
    assert.equal(ui.findButton('Back to Order').disabled, true);
    const cancel = new ui.window.Event('cancel', { cancelable: true });
    ui.dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    ui.findButton('Complete Order').click();
    assert.equal(ui.requests.filter(request => request.url === '/api/orders').length, 1);
    finish(response({ order_id: 10, total: 5.25 }, 201)); await flush();
    assert.match(ui.dialog.textContent, /Order Complete/);
});
