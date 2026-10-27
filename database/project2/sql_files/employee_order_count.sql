-- How many orders did each employee process

SELECT
    employees.name,
    COUNT(*) as order_count
FROM customer_orders
JOIN employees
    ON customer_orders.employee_id = employees.employee_id
GROUP BY employees.name
ORDER BY order_count DESC;
