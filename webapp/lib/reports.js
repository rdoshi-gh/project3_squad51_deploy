const { dateRange, InputError } = require('./validation');
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
const metric = (label, value) => ({ label, value });
const LAST_WEEK = 'WITH w AS (SELECT MAX(order_timestamp)::date AS e FROM customer_orders) ';

async function getRange(db) {
    const [row] = await db.query(`SELECT MIN(order_timestamp)::date::text AS first,
        MAX(order_timestamp)::date::text AS last, (MAX(order_timestamp)::date - 6)::text AS start FROM customer_orders`);
    const today = new Date().toISOString().slice(0, 10);
    return { first: row?.first || today, last: row?.last || today, start: row?.start || today };
}

async function getReport(db, type, start, end) {
    const historical = ['daily', 'top', 'sales', 'usage'].includes(type);
    const params = historical ? dateRange(start, end) : [];
    const window = "o.order_timestamp >= $1::date AND o.order_timestamp < $2::date + interval '1 day'";
    if (type === 'daily') {
        const rows = await db.query(`SELECT order_timestamp::date::text AS day, COUNT(*) AS orders, SUM(total_price) AS revenue
            FROM customer_orders o WHERE ${window} GROUP BY order_timestamp::date ORDER BY day`, params);
        const orders = rows.reduce((sum, row) => sum + Number(row.orders), 0);
        const revenue = rows.reduce((sum, row) => sum + Number(row.revenue), 0);
        return { title: 'Daily Sales Summary', columns: ['Date', 'Orders', 'Revenue', 'Average Order'],
            rows: rows.map(row => [row.day, Number(row.orders), money(row.revenue), money(Number(row.revenue) / Number(row.orders))]),
            metrics: [metric('Orders', orders), metric('Revenue', money(revenue)), metric('Average order', money(orders ? revenue / orders : 0))],
            chart: { title: 'Daily revenue', unit: 'USD', points: rows.map(row => ({ label: row.day, value: Number(row.revenue) })) },
            note: `${start} through ${end}`, empty: 'No orders were placed in this period.' };
    }
    if (type === 'top' || type === 'sales') {
        const rows = await db.query(`SELECT m.name, m.category, SUM(oi.quantity) AS quantity, m.price,
            SUM(oi.quantity) * m.price AS estimated_sales FROM order_items oi
            JOIN customer_orders o USING(order_id) JOIN menu_items m USING(menu_item_id)
            WHERE ${window} GROUP BY m.menu_item_id, m.name, m.category ORDER BY quantity DESC, m.name, m.menu_item_id`, params);
        const quantity = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
        const sales = rows.reduce((sum, row) => sum + Number(row.estimated_sales), 0);
        return { title: type === 'top' ? 'Top Selling Items' : 'Sales Report',
            columns: type === 'top' ? ['Menu Item', 'Category', 'Quantity Sold'] : ['Menu Item', 'Category', 'Units Sold', 'Current Price', 'Estimated Sales'],
            rows: rows.map(row => type === 'top' ? [row.name, row.category, Number(row.quantity)]
                : [row.name, row.category, Number(row.quantity), money(row.price), money(row.estimated_sales)]),
            metrics: [metric('Menu items sold', rows.length), metric('Total units', quantity), ...(type === 'sales' ? [metric('Estimated sales', money(sales))] : [])],
            note: type === 'sales' ? 'Sales estimates use current menu prices; the Project 2 schema does not store historical unit prices.' : `${start} through ${end}`,
            empty: 'No items were sold in this period.' };
    }
    if (type === 'restock' || type === 'inventory') {
        const rows = await db.query(`SELECT name, quantity, unit, reorder_level, reorder_level - quantity AS amount_needed
            FROM inventory_items ${type === 'restock' ? 'WHERE quantity < reorder_level' : ''} ORDER BY name, inventory_item_id`);
        return { title: type === 'restock' ? 'Restock Report' : 'Inventory Status',
            columns: ['Inventory Item', 'Current Quantity', 'Unit', 'Reorder Level', type === 'restock' ? 'Amount Needed' : 'Status'],
            rows: rows.map(row => [row.name, Number(row.quantity), row.unit, Number(row.reorder_level),
                type === 'restock' ? Number(row.amount_needed) : Number(row.quantity) <= Number(row.reorder_level) ? 'Low' : 'OK']),
            metrics: [metric(type === 'restock' ? 'Items needing restock' : 'Inventory items', rows.length),
                ...(type === 'inventory' ? [metric('At or below reorder level', rows.filter(row => Number(row.quantity) <= Number(row.reorder_level)).length)] : [])],
            note: 'Current inventory snapshot; date range does not apply.',
            empty: type === 'restock' ? 'All inventory items meet or exceed their reorder levels.' : 'No inventory items found.' };
    }
    if (type === 'hourly') {
        const rows = await db.query(`WITH sales AS (SELECT EXTRACT(HOUR FROM order_timestamp)::int AS hour,
            COUNT(*) AS orders, SUM(total_price) AS revenue FROM customer_orders
            WHERE order_timestamp >= CURRENT_DATE AND order_timestamp <= LOCALTIMESTAMP GROUP BY 1)
            SELECT CURRENT_DATE::text AS day, h.hour, COALESCE(s.orders,0) AS orders, COALESCE(s.revenue,0) AS revenue
            FROM generate_series(0, EXTRACT(HOUR FROM LOCALTIMESTAMP)::int) h(hour)
            LEFT JOIN sales s ON s.hour = h.hour ORDER BY h.hour`);
        const orders = rows.reduce((sum, row) => sum + Number(row.orders), 0);
        const revenue = rows.reduce((sum, row) => sum + Number(row.revenue), 0);
        const peak = rows.filter(row => Number(row.orders) > 0).sort((a, b) => Number(b.revenue) - Number(a.revenue) || Number(b.orders) - Number(a.orders));
        const peaks = peak.length ? peak.filter(row => Number(row.revenue) === Number(peak[0].revenue) && Number(row.orders) === Number(peak[0].orders)) : [];
        return { title: 'X Report (Hourly Sales)', columns: ['Hour', 'Orders', 'Sales', 'Average Order'],
            rows: rows.map(row => [`${String(row.hour).padStart(2, '0')}:00–${String(Number(row.hour) + 1).padStart(2, '0')}:00`, Number(row.orders), money(row.revenue), money(Number(row.orders) ? Number(row.revenue) / Number(row.orders) : 0)]),
            metrics: [metric('Orders', orders), metric('Sales', money(revenue)), metric('Average order', money(orders ? revenue / orders : 0))],
            chart: { title: 'Hourly sales', unit: 'USD', points: rows.map(row => ({ label: `${row.hour}:00`, value: Number(row.revenue) })) },
            note: `${rows[0]?.day || 'Today'} in database time. Current hour is in progress. Busiest hour: ${peaks.length ? peaks.map(row => `${row.hour}:00`).join(', ') : 'no sales recorded'}. Refresh to update.`,
            empty: 'No sales recorded today.' };
    }
    if (type === 'usage') {
        const rows = await db.query(`SELECT i.name, i.unit, i.quantity AS stock, COALESCE(SUM(s.quantity * r.quantity_required),0) AS used
            FROM inventory_items i LEFT JOIN recipes r USING(inventory_item_id)
            LEFT JOIN (SELECT oi.menu_item_id, oi.quantity FROM order_items oi JOIN customer_orders o USING(order_id)
                WHERE ${window}) s USING(menu_item_id)
            GROUP BY i.inventory_item_id, i.name, i.unit, i.quantity ORDER BY i.unit, used DESC, i.name`, params);
        const [totals] = await db.query(`SELECT COUNT(*) AS orders FROM customer_orders o WHERE ${window}`, params);
        return { title: 'Product Usage', columns: ['Inventory Item', 'Unit', 'Amount Used', 'Current Stock'],
            rows: rows.map(row => [row.name, row.unit, Number(row.used), Number(row.stock)]),
            metrics: [metric('Orders in period', Number(totals.orders)), metric('Inventory items used', rows.filter(row => Number(row.used) > 0).length)],
            groups: [...new Set(rows.map(row => row.unit))].map(unit => ({ title: `Inventory used (${unit})`, unit,
                points: rows.filter(row => row.unit === unit).map(row => ({ label: row.name, value: Number(row.used), stock: Number(row.stock) })) })),
            note: 'Usage is calculated from order quantities and current recipes. Bars compare items measured in the same unit.',
            empty: 'No inventory items found.' };
    }
    throw new InputError('Choose a supported report.');
}

module.exports = { getReport, getRange, money, LAST_WEEK };
