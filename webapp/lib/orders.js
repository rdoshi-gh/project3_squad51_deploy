const { InputError, number, id } = require('./validation');

function buildOrder(raw, menu) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new InputError('Add 1–100 items to the order.');
    const byId = new Map(menu.map(item => [Number(item.menu_item_id), item]));
    const sold = new Map();
    let totalCents = 0;
    const lines = raw.map(line => {
        if (!line || typeof line !== 'object' || Array.isArray(line)) throw new InputError('Choose a valid order item.');
        const item = byId.get(id(line.menuItemId));
        if (!item || item.category.toLowerCase() === 'topping') throw new InputError('Choose an available drink or food item.');
        const quantity = number(line.quantity, 'Quantity', { min: 1, max: 99, integer: true });
        const sweetness = number(line.sweetness ?? 100, 'Sweetness', { min: 0, max: 100, integer: true });
        const ice = line.ice ?? 'Regular';
        if (!['No', 'Light', 'Regular', 'Extra'].includes(ice)) throw new InputError('Choose a valid ice level.');
        if (line.toppings !== undefined && !Array.isArray(line.toppings)) throw new InputError('Choose valid toppings.');
        const toppingIds = [...new Set((line.toppings || []).map(id))];
        const toppings = toppingIds.map(toppingId => {
            const topping = byId.get(toppingId);
            if (!topping || topping.category.toLowerCase() !== 'topping') throw new InputError('Choose an available topping.');
            return topping;
        });
        let eachCents = Math.round(Number(item.price) * 100);
        for (const topping of toppings) eachCents += Math.round(Number(topping.price) * 100);
        totalCents += eachCents * quantity;
        for (const product of [item, ...toppings]) sold.set(Number(product.menu_item_id), (sold.get(Number(product.menu_item_id)) || 0) + quantity);
        return { menuItemId: item.menu_item_id, name: item.name, quantity, sweetness, ice, toppings: toppingIds, eachCents };
    });
    if (totalCents > 99999999) throw new InputError('This order exceeds the supported total.');
    return { lines, sold, totalCents };
}

async function saveOrder(db, employeeId, raw) {
    return db.transaction(async client => {
        // Obtain the ID-allocation lock before stock locks so simultaneous orders use one lock order.
        const orderId = await db.nextId(client, 'customer_orders', 'order_id');
        let itemId = await db.nextId(client, 'order_items', 'order_item_id');
        const menu = (await client.query('SELECT menu_item_id, name, category, price FROM menu_items')).rows;
        const order = buildOrder(raw, menu);
        const ids = [...order.sold.keys()];
        const quantities = ids.map(menuId => order.sold.get(menuId));
        const needs = (await client.query(`SELECT r.inventory_item_id, SUM(r.quantity_required * sold.quantity) AS needed
            FROM recipes r JOIN unnest($1::int[], $2::int[]) AS sold(menu_item_id, quantity) USING (menu_item_id)
            GROUP BY r.inventory_item_id ORDER BY r.inventory_item_id`, [ids, quantities])).rows;
        const stock = (await client.query(`SELECT inventory_item_id, name, quantity, unit FROM inventory_items
            WHERE inventory_item_id = ANY($1::int[]) ORDER BY inventory_item_id FOR UPDATE`, [needs.map(row => row.inventory_item_id)])).rows;
        const stockById = new Map(stock.map(row => [Number(row.inventory_item_id), row]));
        for (const need of needs) {
            const item = stockById.get(Number(need.inventory_item_id));
            if (!item || Number(item.quantity) + 0.000001 < Number(need.needed)) {
                throw new InputError(`Not enough inventory: ${item ? `${item.name} (${item.unit})` : 'an ingredient is unavailable'}.`, 409);
            }
        }
        const result = await client.query(`INSERT INTO customer_orders (order_id, employee_id, order_timestamp, total_price)
            VALUES ($1, $2, NOW(), $3) RETURNING order_id, order_timestamp`, [orderId, employeeId, order.totalCents / 100]);
        for (const [menuId, quantity] of order.sold) {
            await client.query('INSERT INTO order_items (order_item_id, order_id, menu_item_id, quantity) VALUES ($1,$2,$3,$4)', [itemId++, orderId, menuId, quantity]);
        }
        for (const need of needs) {
            await client.query('UPDATE inventory_items SET quantity = quantity - $1::numeric WHERE inventory_item_id = $2', [need.needed, need.inventory_item_id]);
        }
        return { ...result.rows[0], total: order.totalCents / 100 };
    });
}

module.exports = { buildOrder, saveOrder };
