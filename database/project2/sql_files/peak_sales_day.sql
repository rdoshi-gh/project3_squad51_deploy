-- Special Query #2: "Peak Sales Day"

-- pseudocode: select top 10 sums of order total grouped by day in descending order by order total
-- about: which 10 days had the highest total sales, and how many orders were placed on each?
-- example: "2026-08-24 had 1234 orders totaling $9876.50"


SELECT
    DATE(order_timestamp) AS sales_day,
    COUNT(*) AS daily_order_count,
    SUM(total_price) AS daily_sales_total
FROM customer_orders
GROUP BY DATE(order_timestamp)
ORDER BY daily_sales_total DESC
LIMIT 10;
