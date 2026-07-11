-- =====================================================
-- Migration 014b: Sync Engine follow-ups (post-review)
-- =====================================================
-- The original 014 used `transaction_date` as the cursor for
-- /api/sync/pull, but that timestamp is set once when the sale is
-- recorded and never moves. Voids, payment-status changes, and
-- backdated re-imports therefore never appeared in subsequent
-- deltas, so a tablet that synced before the void would show the
-- sale as still active forever. We give `sales` an `updated_at`
-- column with the same trigger pattern we use on `customers` so the
-- cursor reflects the most recent server-side mutation.
--
-- We also store the most recent idempotency_keys index in a way that
-- supports the 30-day retention cleanup script.
-- =====================================================

-- ── 1. sales.updated_at + touch trigger ──────────────────────────────
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill so the column is populated for existing rows.
UPDATE sales
   SET updated_at = COALESCE(transaction_date, CURRENT_TIMESTAMP)
 WHERE updated_at IS NULL OR updated_at < COALESCE(transaction_date, CURRENT_TIMESTAMP);

CREATE OR REPLACE FUNCTION touch_sales_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_touch_updated_at ON sales;
CREATE TRIGGER trg_sales_touch_updated_at
    BEFORE UPDATE ON sales
    FOR EACH ROW
    EXECUTE FUNCTION touch_sales_updated_at();

-- Index used by /api/sync/pull range scan (sales WHERE updated_at > $1).
CREATE INDEX IF NOT EXISTS idx_sales_updated_at ON sales(updated_at);

-- ── 2. Idempotency key 30-day retention helper ───────────────────────
-- The cleanup script (scripts/cleanup-idempotency.js) and the lazy
-- cleanup inside syncController.push both delete rows where
-- created_at < NOW() - INTERVAL '30 days'. The existing index on
-- created_at is sufficient; this comment is a deliberate marker so
-- future schema changes don't accidentally drop that index.
COMMENT ON INDEX idx_idempotency_created_at IS
    'Used by 30-day retention cleanup. Do not drop without updating cleanup-idempotency.js.';
