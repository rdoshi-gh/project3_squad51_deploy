-- Which orders contained the most items, and which employee processed them
-- example: "Order 92930 had 12 items totaling $42.40 and was processed by Phillip Ronin"

SELECT
    customer_orders.order_id,
    customer_orders.order_timestamp,
    employees.name AS employee_name,
    SUM(order_items.quantity) AS total_items,
    customer_orders.total_price
FROM customer_orders
JOIN order_items
    ON customer_orders.order_id = order_items.order_id
JOIN employees
    ON customer_orders.employee_id = employees.employee_id
GROUP BY
    customer_orders.order_id,
    customer_orders.order_timestamp,
    employees.name,
    customer_orders.total_price
ORDER BY
    total_items DESC,
    customer_orders.total_price DESC
LIMIT 10;
