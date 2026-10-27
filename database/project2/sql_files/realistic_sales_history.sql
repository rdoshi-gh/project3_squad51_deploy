-- Special Query #3: "Realistic Sales History"

-- pseudocode: select count of orders, sum of order total grouped by hour
-- about: given a specific hour of the day, how many orders were placed and what was the total sum of the orders?
-- example: "12pm has 12345 orders totaling $86753"


SELECT
    EXTRACT(HOUR FROM order_timestamp) AS hour,
    COUNT(*) AS hourly_order_count,
    SUM(total_price) AS hourly_sales_total
FROM customer_orders
GROUP BY EXTRACT(HOUR FROM order_timestamp)
ORDER BY hour;
