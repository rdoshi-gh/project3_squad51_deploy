-- How many items were sold and how much revenue did each menu category bring in
-- example: "Milk Tea sold 63640 items for $364741.50"

SELECT
    menu_items.category,
    SUM(order_items.quantity) AS items_sold,
    SUM(order_items.quantity * menu_items.price) AS category_revenue
FROM order_items
JOIN menu_items
    ON order_items.menu_item_id = menu_items.menu_item_id
GROUP BY menu_items.category
ORDER BY category_revenue DESC;
