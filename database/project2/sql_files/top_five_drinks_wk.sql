-- "top 5 drinks of the last week"
-- (top_five_drinks_wk.sql)
SELECT
    m.menu_item_id,
    m.name AS top_drinks,
    SUM(oi.quantity) AS total_quantity_sold
FROM
    menu_items m
JOIN
    order_items oi ON m.menu_item_id = oi.menu_item_id
JOIN
    customer_orders co ON oi.order_id = co.order_id
WHERE
    co.order_timestamp >= (SELECT MAX(order_timestamp) FROM customer_orders) - INTERVAL '7 days'
    AND m.category != 'Topping'
GROUP BY
    m.menu_item_id,
    m.name
ORDER BY
    total_quantity_sold DESC
LIMIT 5;
