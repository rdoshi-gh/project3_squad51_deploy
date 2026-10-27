-- How many orders and how much revenue did each month bring in
-- (supports the "Analyzing Order Trends" interaction)
-- example: "2026-03 had 8120 orders totaling $92450.00"

SELECT
    DATE_TRUNC('month', order_timestamp)::date AS month,
    COUNT(*) AS order_count,
    SUM(total_price) AS monthly_sales
FROM customer_orders
GROUP BY DATE_TRUNC('month', order_timestamp)
ORDER BY month;
