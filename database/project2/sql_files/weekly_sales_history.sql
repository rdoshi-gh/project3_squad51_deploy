-- Special Query #1: "Weekly Sales History"

-- pseudocode: select count of orders grouped by week
-- about: given a specific week, how many orders were placed?
-- example: "week 1 has 98765 orders"


SELECT
    DATE_TRUNC('week', order_timestamp) AS week,
    COUNT(*) as weekly_order_count
FROM customer_orders
GROUP BY DATE_TRUNC('week', order_timestamp)
ORDER BY week;
