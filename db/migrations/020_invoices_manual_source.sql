-- v1.0.14 — Allow manual (one-off) invoices that aren't tied to a sale
-- or quote. Up to v1.0.13 every invoice had to come from a credit sale
-- or accepted quote (see migration 019); the back-office workflows that
-- need a standalone retainer / reimbursement / ad-hoc service invoice
-- had no way to land in the schema.
--
-- This migration:
--   1. Relaxes the source_kind CHECK so 'manual' is a valid value
--      alongside the existing 'sale' / 'quote'.
--   2. Replaces the source_xor CHECK so 'manual' rows must have BOTH
--      source_sale_id and source_quote_id NULL (still XOR for the auto
--      cases — only the third arm is new).
--
-- The pre-existing partial UNIQUE indexes on source_sale_id /
-- source_quote_id are unchanged: they only kick in WHERE the column is
-- NOT NULL, so manual invoices (where both are NULL) are never
-- considered for uniqueness — multiple manual invoices co-exist freely.

-- The original CHECK on source_kind was declared inline (no name) in
-- migration 019, so PostgreSQL auto-named it `invoices_source_kind_check`.
-- Drop both constraints by name with IF EXISTS so the migration is safe
-- to re-run and tolerant of legacy DBs where the auto-name may differ.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_kind_check;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_xor;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_source_kind_check
    CHECK (source_kind IN ('sale', 'quote', 'manual'));

ALTER TABLE invoices
    ADD CONSTRAINT invoices_source_xor CHECK (
        (source_kind = 'sale'   AND source_sale_id  IS NOT NULL AND source_quote_id IS NULL) OR
        (source_kind = 'quote'  AND source_quote_id IS NOT NULL AND source_sale_id  IS NULL) OR
        (source_kind = 'manual' AND source_sale_id  IS NULL     AND source_quote_id IS NULL)
    );
