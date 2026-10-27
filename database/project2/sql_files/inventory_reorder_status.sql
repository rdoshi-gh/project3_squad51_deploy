-- Which inventory items are closest to reaching their reorder level
-- example: "Coffee Concentrate has 25 gallons remaining with a reorder level of 5 gallons"

SELECT
    name,
    quantity,
    unit,
    reorder_level,
    quantity - reorder_level AS amount_above_reorder
FROM inventory_items
ORDER BY
    amount_above_reorder ASC,
    name
LIMIT 10;
