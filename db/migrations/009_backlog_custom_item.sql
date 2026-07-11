-- Allow 'custom' item type in sale_items for backlog / freehand entries
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS chk_item_type;
ALTER TABLE sale_items ADD CONSTRAINT chk_item_type CHECK (
    (item_type = 'product' AND product_id IS NOT NULL)
    OR (item_type = 'service' AND service_id IS NOT NULL)
    OR (item_type = 'custom')
);
