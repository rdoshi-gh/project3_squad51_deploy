-- Which bubble tea toppings are added to drinks most often
-- example: "Popping Boba was added 15194 times"

SELECT
    menu_items.name AS topping,
    SUM(order_items.quantity) AS times_added
FROM order_items
JOIN menu_items
    ON order_items.menu_item_id = menu_items.menu_item_id
WHERE menu_items.category = 'Topping'
GROUP BY menu_items.name
ORDER BY times_added DESC;
