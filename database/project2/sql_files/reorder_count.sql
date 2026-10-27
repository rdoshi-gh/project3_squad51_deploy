-- Which inventory items were reordered most often

SELECT
    inventory_items.name,
    COUNT(*) as reorder_count
FROM reorder_requests
JOIN inventory_items
    ON inventory_items.inventory_item_id = reorder_requests.inventory_item_id
GROUP BY inventory_items.name
ORDER BY reorder_count DESC;
