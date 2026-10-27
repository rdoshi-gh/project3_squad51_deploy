-- Phase 4 Restock Report: current inventory strictly below its reorder level.
-- An item at the reorder level does not need restocking for this report.
-- Amount needed is measured in the item's own unit; this query only reads data.
SELECT
    name AS inventory_item,
    quantity AS current_quantity,
    unit,
    reorder_level,
    reorder_level - quantity AS amount_needed
FROM inventory_items
WHERE quantity < reorder_level
ORDER BY name, inventory_item_id;
