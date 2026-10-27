-- How much of each inventory item has been consumed by sales, and how much is left
-- (orders -> order items -> recipes -> inventory, per the "Updating Inventory From Orders" interaction)
-- example: "Tapioca Pearls: 48210.00 lb used across all orders, 35.00 lb currently in stock"

SELECT
    inventory_items.name,
    inventory_items.unit,
    SUM(order_items.quantity * recipes.quantity_required) AS total_used,
    inventory_items.quantity AS current_quantity
FROM order_items
JOIN recipes
    ON order_items.menu_item_id = recipes.menu_item_id
JOIN inventory_items
    ON recipes.inventory_item_id = inventory_items.inventory_item_id
GROUP BY
    inventory_items.inventory_item_id,
    inventory_items.name,
    inventory_items.unit,
    inventory_items.quantity
ORDER BY total_used DESC;
