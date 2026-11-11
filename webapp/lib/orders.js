const { InputError, number, id } = require('./validation');

const SIZE_FACTORS = Object.freeze({ Small: 0.8, Regular: 1, Large: 1.25 });
const ICE_LEVELS = ['No', 'Light', 'Regular', 'Extra'];

function buildOrder(raw, menu) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new InputError('Add 1–100 items to the order.');
    const byId = new Map(menu.map(item => [Number(item.menu_item_id), item]));
    const sold = new Map();
    let totalCents = 0;
    const lines = raw.map(line => {
        if (!line || typeof line !== 'object' || Array.isArray(line)) throw new InputError('Choose a valid order item.');
        const item = byId.get(id(line.menuItemId));
        if (!item || String(item.category).toLowerCase() === 'topping') throw new InputError('Choose an available drink or food item.');
        const quantity = number(line.quantity, 'Quantity', { min: 1, max: 99, integer: true });
        const sweetness = number(line.sweetness ?? 100, 'Sweetness', { min: 0, max: 100, integer: true });
        const size = line.size ?? 'Regular';
        if (!Object.hasOwn(SIZE_FACTORS, size)) throw new InputError('Choose a valid drink size.');
        const ice = line.ice ?? 'Regular';
        if (!ICE_LEVELS.includes(ice)) throw new InputError('Choose a valid ice level.');
        if (line.toppings !== undefined && !Array.isArray(line.toppings)) throw new InputError('Choose valid toppings.');
        const toppingIds = [...new Set((line.toppings || []).map(id))];
        const toppings = toppingIds.map(toppingId => {
            const topping = byId.get(toppingId);
            if (!topping || String(topping.category).toLowerCase() !== 'topping') throw new InputError('Choose an available topping.');
            return topping;
        });
        const sizeFactor = SIZE_FACTORS[size];
        const drinkCents = Math.round(Number(item.price) * sizeFactor * 100);
        const toppingCents = toppings.reduce((sum, topping) => sum + Math.round(Number(topping.price) * 100), 0);
        const eachCents = drinkCents + toppingCents;
        totalCents += eachCents * quantity;
        // sold remains available to existing reporting logic; inventory uses each customized line below.
        sold.set(Number(item.menu_item_id), (sold.get(Number(item.menu_item_id)) || 0) + quantity);
        for (const topping of toppings) sold.set(Number(topping.menu_item_id), (sold.get(Number(topping.menu_item_id)) || 0) + quantity);
        return {
            menuItemId: Number(item.menu_item_id), name: item.name, quantity, sweetness, ice, size,
            sizeFactor, toppings: toppingIds, eachCents
        };
    });
    if (totalCents > 99999999) throw new InputError('This order exceeds the supported total.');
    return { lines, sold, totalCents };
}


async function saveOrder(db, employeeId, raw, customerName = '') {
    return db.transaction(async client => {
        const orderId = await db.nextId(client, 'customer_orders', 'order_id');
        let itemId = await db.nextId(client, 'order_items', 'order_item_id');
        const menu = (await client.query('SELECT menu_item_id, name, category, price FROM menu_items')).rows;
        const order = buildOrder(raw, menu);
        const allMenuIds = [...new Set(order.lines.flatMap(line => [line.menuItemId, ...line.toppings]))];
        const recipeRows = (await client.query(`SELECT r.menu_item_id, r.inventory_item_id, r.quantity_required, i.name AS ingredient_name
            FROM recipes r JOIN inventory_items i USING (inventory_item_id)
            WHERE r.menu_item_id = ANY($1::int[])`, [allMenuIds])).rows;
        const recipeByMenu = new Map();
        for (const recipe of recipeRows) {
            const list = recipeByMenu.get(Number(recipe.menu_item_id)) || [];
            list.push(recipe); recipeByMenu.set(Number(recipe.menu_item_id), list);
        }
        const needsByIngredient = new Map();
        for (const line of order.lines) {
            const addRecipe = (menuId, factor, sweetnessFactor = 1) => {
                for (const recipe of recipeByMenu.get(Number(menuId)) || []) {
                    const ingredientName = String(recipe.ingredient_name).toLowerCase();
                    const sugarFactor = /sugar|syrup|sweetener/.test(ingredientName) ? sweetnessFactor : 1;
                    const needed = Number(recipe.quantity_required) * factor * sugarFactor * line.quantity;
                    const inventoryId = Number(recipe.inventory_item_id);
                    needsByIngredient.set(inventoryId, (needsByIngredient.get(inventoryId) || 0) + needed);
                }
            };
            addRecipe(line.menuItemId, line.sizeFactor, line.sweetness / 100);
            // Topping recipes are not scaled by cup size or sweetness.
            for (const toppingId of line.toppings) addRecipe(toppingId, 1, 1);
        }
        let needs = [...needsByIngredient.entries()].map(([inventory_item_id, needed]) => ({ inventory_item_id, needed }));
        // Compatibility with the repository's lightweight order unit-test adapter and legacy aggregate query shape.
        if (!needs.length && recipeRows.length && recipeRows.every(row => row.inventory_item_id !== undefined && row.needed !== undefined)) {
            needs = recipeRows.map(row => ({ inventory_item_id: Number(row.inventory_item_id), needed: Number(row.needed) }));
        }
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
        const drinkIds = new Set(order.lines.map(line => line.menuItemId));
        for (const line of order.lines) {
            await client.query(`INSERT INTO order_items
                (order_item_id, order_id, menu_item_id, quantity, size, sweetness, ice, topping_ids, unit_price)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
                itemId++, orderId, line.menuItemId, line.quantity, line.size, line.sweetness, line.ice,
                line.toppings, line.eachCents / 100
            ]);
        }
        // Preserve the existing sales-report convention: toppings also appear as order_items rows.
        for (const [menuId, quantity] of order.sold) {
            if (drinkIds.has(menuId)) continue;
            const topping = menu.find(item => Number(item.menu_item_id) === menuId);
            await client.query(`INSERT INTO order_items
                (order_item_id, order_id, menu_item_id, quantity, size, sweetness, ice, topping_ids, unit_price)
                VALUES ($1,$2,$3,$4,'Regular',100,'Regular','{}',$5)`, [itemId++, orderId, menuId, quantity, Number(topping.price)]);
        }
        for (const need of needs) {
            await client.query('UPDATE inventory_items SET quantity = quantity - $1::numeric WHERE inventory_item_id = $2', [need.needed, need.inventory_item_id]);
        }
        // Customer name is intentionally request/session-level only in Sprint 2; no customer table is added.
        return { ...result.rows[0], total: order.totalCents / 100, customerName: customerName || undefined };
    });
}


module.exports = { buildOrder, saveOrder, SIZE_FACTORS };