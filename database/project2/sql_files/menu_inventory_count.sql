-- "the count of inventory items in a given menu item"
-- (menu_inventory_item.sql)
SELECT
    m.name,
    COUNT(r.inventory_item_id) AS inventory_items_needed_count
FROM
    menu_items m
JOIN
    recipes r ON m.menu_item_id = r.menu_item_id
GROUP BY
    m.menu_item_id,
    m.name;
