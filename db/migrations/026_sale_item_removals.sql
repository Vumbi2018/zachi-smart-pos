-- 026_sale_item_removals.sql
--
-- v1.0.31 (Task #57) — Per-line refund / "Remove line" support.
--
-- Today the only way to undo a single mistaken line on a completed
-- sale is to Reverse the whole sale and re-ring everything else.
-- That is slow and clutters Daily Sales. This migration adds three
-- nullable bookkeeping columns to sale_items so the new
-- DELETE /api/sales/:id/items/:itemId endpoint can soft-mark a line
-- as removed (restoring stock + recomputing totals + posting cash
-- refund) while keeping the row in place for the audit trail.
--
-- Deliberate choices:
--   • Soft delete (nullable timestamp + actor + reason) rather than
--     a hard DELETE so reprinted receipts can still show the struck
--     line and the audit trail stays intact.
--   • Plain ALTER ADD COLUMN IF NOT EXISTS — additive only, no
--     existing read paths break because every consumer either
--     ignores unknown columns or selects sale_items.* and forwards.
--   • removed_by references users(user_id) (UUID in the live DB),
--     mirroring how voided_by / staff_id are wired on `sales`.

ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS removed_at      TIMESTAMP NULL;

ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS removed_by      UUID REFERENCES users(user_id);

ALTER TABLE sale_items
    ADD COLUMN IF NOT EXISTS removed_reason  TEXT;

-- Lookups for the audit / reporting view ("show all line removals
-- in the last 7 days"). Partial index keeps it tiny because the
-- vast majority of sale_items rows will never be removed.
CREATE INDEX IF NOT EXISTS idx_sale_items_removed_at
    ON sale_items(removed_at)
    WHERE removed_at IS NOT NULL;
