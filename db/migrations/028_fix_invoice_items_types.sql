-- v1.0.52 recovery follow-up
--
-- The recovered local database recorded this migration but the source file was
-- missing from the archived app tree. The final recovered schema shows
-- invoice_items.product_id and invoice_items.service_id as integer columns,
-- matching the product/service primary keys used by this branch.
--
-- Migration 019 originally introduced invoice_items with UUID product/service
-- columns. On integer-key databases that makes manual/product invoice rows fail
-- when controllers pass the existing product_id/service_id values through.

ALTER TABLE invoice_items
    ALTER COLUMN product_id TYPE INTEGER
    USING CASE
        WHEN product_id IS NULL THEN NULL
        WHEN product_id::text ~ '^[0-9]+$' THEN product_id::text::INTEGER
        ELSE NULL
    END;

ALTER TABLE invoice_items
    ALTER COLUMN service_id TYPE INTEGER
    USING CASE
        WHEN service_id IS NULL THEN NULL
        WHEN service_id::text ~ '^[0-9]+$' THEN service_id::text::INTEGER
        ELSE NULL
    END;
