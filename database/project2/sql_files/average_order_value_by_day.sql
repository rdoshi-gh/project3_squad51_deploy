-- What is the average order value for each day of the week
-- example: "Sunday had 16638 orders with an average order value of $11.16"

SELECT
    TO_CHAR(order_timestamp, 'FMDay') AS day_of_week,
    COUNT(*) AS order_count,
    ROUND(AVG(total_price), 2) AS average_order_value
FROM customer_orders
GROUP BY
    EXTRACT(DOW FROM order_timestamp),
    TO_CHAR(order_timestamp, 'FMDay')
ORDER BY EXTRACT(DOW FROM order_timestamp);
