-- 023_sale_payments.sql
-- v1.0.18 — Split-tender support.
--
-- Today every sale stores exactly one payment_method + amount_paid.
-- This migration adds a child `sale_payments` table so a single sale
-- can be paid with multiple methods (e.g. K500 cash + K1,200 MTN
-- Money). Existing single-tender sales are backfilled so reports and
-- the new breakdown UI render uniformly across history.
--
-- Deliberate choices:
--   • A child table (not extra columns on `sales`) keeps the schema
--     normalised and lets us add tender-level fields later (e.g.
--     gateway transaction_id for mobile money) without further
--     migrations.
--   • `tender_type` is reserved for future change/rounding rows but
--     defaults to 'sale' for everything we insert today.
--   • Backfill is idempotent — only inserts when no row exists yet
--     for that sale_id, so re-running the migration is safe.
--   • `sales.payment_method` is preserved for back-compat with the
--     sync engine, reports, and any older clients that still write
--     single-method payloads. When a sale has multiple distinct
--     methods, salesController stores 'Mixed' there.

-- Up Migration
-- Note on FK column types: although 001_initial_schema.sql declares
-- sales.sale_id and users.user_id as SERIAL INT, a later release
-- (sync-engine work) converted both to UUID in the live database.
-- We mirror those types here so the FKs can actually be created.
CREATE TABLE IF NOT EXISTS sale_payments (
    payment_id        SERIAL PRIMARY KEY,
    sale_id           UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    seq               INT  NOT NULL DEFAULT 1,
    payment_method    VARCHAR(50) NOT NULL,
    amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    payment_reference VARCHAR(100),
    tender_type       VARCHAR(20) NOT NULL DEFAULT 'sale'
                      CHECK (tender_type IN ('sale','change','rounding')),
    recorded_by       UUID REFERENCES users(user_id),
    device_id         UUID,
    client_op_id      UUID,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sale_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale    ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_method  ON sale_payments(payment_method);
CREATE INDEX IF NOT EXISTS idx_sale_payments_created ON sale_payments(created_at);

-- Backfill historical sales as a single tender row each. Skips any
-- sale that already has a sale_payments row so re-running this
-- migration is a no-op. Uses amount_paid (what was actually tendered
-- at the till) rather than total_amount, so credit/partial sales
-- backfill correctly with the down-payment portion only.
INSERT INTO sale_payments (sale_id, seq, payment_method, amount,
                            payment_reference, recorded_by, device_id,
                            client_op_id, created_at)
SELECT s.sale_id,
       1,
       COALESCE(s.payment_method, 'Cash'),
       COALESCE(s.amount_paid, 0),
       s.payment_reference,
       s.staff_id,
       s.device_id,
       s.client_op_id,
       s.transaction_date
FROM sales s
WHERE NOT EXISTS (
    SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.sale_id
);
