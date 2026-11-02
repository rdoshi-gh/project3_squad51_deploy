const { InputError } = require('./validation');

// Keep queries in lib/, matching this project's database conventions.
// Use separate limits so a busy queue can't crowd out the ready column.
async function getKitchenOrders(db) {
    const inProgress = await db.query(`
        SELECT order_id, order_timestamp, kitchen_status, ready_at
        FROM customer_orders
        WHERE kitchen_status = 'in_progress'
        ORDER BY order_timestamp ASC, order_id ASC
        LIMIT 100
    `);
    const ready = await db.query(`
        SELECT order_id, order_timestamp, kitchen_status, ready_at
        FROM customer_orders
        WHERE kitchen_status = 'ready'
          AND ready_at >= NOW() - INTERVAL '2 hours'
        ORDER BY ready_at DESC, order_id DESC
        LIMIT 30
    `);
    const orders = [...inProgress, ...ready];
    if (!orders.length) return { inProgress: [], ready: [] };

    // Existing schema records drinks and toppings as separate order_items.
    const rows = await db.query(`
        SELECT oi.order_id, oi.quantity, m.name, m.category
        FROM order_items oi
        JOIN menu_items m USING (menu_item_id)
        WHERE oi.order_id = ANY($1::int[])
        ORDER BY oi.order_id, oi.order_item_id
    `, [orders.map(order => order.order_id)]);
    const byId = new Map(orders.map(order => [Number(order.order_id), { ...order, items: [] }]));
    for (const item of rows) {
        const order = byId.get(Number(item.order_id));
        if (order) order.items.push({ name: item.name, quantity: Number(item.quantity), category: item.category });
    }
    return {
        inProgress: inProgress.map(order => byId.get(Number(order.order_id))),
        ready: ready.map(order => byId.get(Number(order.order_id)))
    };
}

async function markKitchenOrderReady(db, orderId) {
    // The WHERE condition prevents two kitchen employees from completing the
    // same order twice. We never change an existing ready_at timestamp.
    const [updated] = await db.query(`
        UPDATE customer_orders
        SET kitchen_status = 'ready', ready_at = NOW()
        WHERE order_id = $1 AND kitchen_status = 'in_progress'
        RETURNING order_id, kitchen_status, ready_at
    `, [orderId]);
    if (updated) return updated;

    const [existing] = await db.query('SELECT kitchen_status FROM customer_orders WHERE order_id = $1', [orderId]);
    if (!existing) throw new InputError('Order not found.', 404);
    throw new InputError('This order is already ready.', 409);
}

module.exports = { getKitchenOrders, markKitchenOrderReady };
