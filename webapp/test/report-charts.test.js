const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getReport } = require('../lib/reports');
const { createUi } = require('./helpers/ui');

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
