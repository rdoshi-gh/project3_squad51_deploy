const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getReport } = require('../lib/reports');
const { createUi, flush, response } = require('./helpers/ui');

const start = '2026-10-26', end = '2026-11-02';
test('sales charts rank by their own measure and retain current-price disclosure', async () => {
    const db = { query: async () => [
        { name: 'Tea', category: 'Drinks', quantity: '10', price: '2', estimated_sales: '20' },
        { name: 'Latte', category: 'Drinks', quantity: '4', price: '6', estimated_sales: '24' }
    ] };
    const top = await getReport(db, 'top', start, end);
    const sales = await getReport(db, 'sales', start, end);
    assert.deepEqual(top.chart.points, [{ label: 'Tea', value: 10 }, { label: 'Latte', value: 4 }]);
    assert.deepEqual(sales.chart.points, [{ label: 'Latte', value: 24 }, { label: 'Tea', value: 20 }]);
    assert.equal(sales.chart.unit, 'USD');
    assert.match(sales.note, /current menu prices/);
});

test('inventory comparisons separate units and expose stock and reorder thresholds', async () => {
    const db = { query: async () => [
        { name: 'Milk', quantity: '2', unit: 'gal', reorder_level: '5', amount_needed: '3' },
        { name: 'Cups', quantity: '100', unit: 'each', reorder_level: '200', amount_needed: '100' }
    ] };
    const inventory = await getReport(db, 'inventory');
    assert.deepEqual(inventory.groups.map(group => group.unit), ['gal', 'each']);
    assert.deepEqual(inventory.groups[0].points, [{ label: 'Milk', value: 2, reorder: 5 }]);
    assert.equal(inventory.groups[0].series.length, 2);
    const restock = await getReport(db, 'restock');
    assert.equal(restock.groups[0].points[0].value, 3);
    assert.equal(restock.groups[0].series[0].label, 'Amount needed');
});

test('comparison bars use one scale, show exact units, and safely render item labels', async t => {
    const ui = await createUi({ view: 'manager' });
    t.after(() => ui.dom.window.close());
    const chart = ui.POS.chart({ title: 'Stock', unit: 'gal',
        series: [{ key: 'value', label: 'Stock' }, { key: 'reorder', label: 'Threshold' }],
        points: [{ label: '<img src=x>', value: 2, reorder: 5 }] });
    const bars = [...chart.querySelectorAll('progress')];
    assert.deepEqual(bars.map(bar => bar.max), [5, 5]);
    assert.deepEqual(bars.map(bar => bar.value), [2, 5]);
    assert.match(bars[1].getAttribute('aria-label'), /Threshold: 5 gal/);
    assert.equal(chart.querySelector('img'), null);
    assert.match(chart.textContent, /2 gal/);
});

test('usage compares historical consumption with explicitly identified current stock', async () => {
    const db = { query: async sql => sql.includes('COUNT(*)') ? [{ orders: '3' }] : [
        { name: 'Milk', unit: 'gal', used: '4.5', stock: '2' }
    ] };
    const report = await getReport(db, 'usage', start, end);
    assert.deepEqual(report.groups[0].points, [{ label: 'Milk', value: 4.5, stock: 2 }]);
    assert.deepEqual(report.groups[0].series.map(series => series.key), ['value', 'stock']);
    assert.match(report.note, /not stock at the end/);
});

for (const type of ['daily', 'top', 'sales', 'inventory', 'restock', 'hourly', 'usage']) {
    test(`${type} report renders its visualization alongside the table`, async t => {
        const db = { query: async sql => sql.includes('COUNT(*) AS orders FROM') ? [{ orders: '1' }] : [
            { name: 'Tea', category: 'Drinks', quantity: '2', price: '3', estimated_sales: '6',
                day: start, hour: 9, orders: '1', revenue: '6', unit: 'each', reorder_level: '4', amount_needed: '2', used: '1', stock: '2' }
        ] };
        const report = await getReport(db, type, start, end);
        const ui = await createUi({ view: 'manager', page: type === 'usage' ? 'usage' : 'reports',
            fetch: async url => response(url.endsWith('/range') ? { first: start, start, last: end } : report) });
        t.after(() => ui.dom.window.close());
        ui.run('manager');
        await flush();
        if (type !== 'usage') {
            const select = ui.document.querySelector('select');
            select.value = type;
            ui.findButton('Refresh Report', ui.document).click();
            await flush();
        }
        const main = ui.document.getElementById('manager-main');
        assert.ok(main.querySelector('table'));
        assert.ok(main.querySelector('progress'));
        assert.match(main.textContent, new RegExp(report.title.replace(/[()]/g, '\\$&')));
    });
}

test('empty and zero charts provide readable feedback without invalid scales', async t => {
    const ui = await createUi({ view: 'manager' });
    t.after(() => ui.dom.window.close());
    assert.match(ui.POS.chart({ title: 'Sales', unit: 'USD', points: [] }).textContent, /No data available/);
    const chart = ui.POS.chart({ title: 'Sales', unit: 'USD', points: [{ label: 'Tea', value: 0 }] });
    assert.equal(chart.querySelector('progress').max, 1);
    assert.equal(chart.querySelector('progress').value, 0);
    assert.match(chart.textContent, /\$0.00/);
});
