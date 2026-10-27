-- "peak sales week of the last month and total sales"
-- (peak_week_of_month.sql)
SELECT
    DATE(DATE_TRUNC('week', co.order_timestamp)) AS peak_week_last_month,
    SUM(co.total_price) AS total_sales
FROM
    customer_orders co
WHERE
    co.order_timestamp >= DATE_TRUNC('month', (SELECT MAX(order_timestamp) FROM customer_orders))
    AND co.order_timestamp < DATE_TRUNC('month', (SELECT MAX(order_timestamp) FROM customer_orders)) + INTERVAL '1 month'
GROUP BY
    peak_week_last_month
ORDER BY
    total_sales DESC
LIMIT 1;
