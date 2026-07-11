-- =====================================================
-- Migration 017: Credit-sale due date + reminder tracking
-- =====================================================
-- Adds two NULLable columns to `sales` so the credit-sale workflow
-- can: (a) carry a payment deadline that drives the new daily
-- reminder cron and the Credit Orders "due in N days" badges, and
-- (b) avoid spamming the director with the same overdue summary
-- every single morning.
--
-- Both columns are additive only — no destructive change is made
-- to existing rows, and the SERIAL primary key `sales.sale_id` is
-- left exactly as it was (so any existing receipt PDFs, stock
-- movements, credit_payments, loyalty_transactions, etc. keep
-- referencing the same sale ids without any rewrite).
--
-- Backfill: existing Credit / Partial sales get a default due_date
-- of (transaction_date + 30 days). Fully-paid sales (the vast
-- majority) stay NULL — the column is meaningless for them.
-- =====================================================

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS due_date DATE;

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;

-- Backfill: any existing outstanding sale gets a 30-day default
-- deadline anchored to its original transaction_date. We only
-- touch rows that are still genuinely outstanding to keep the
-- update tightly scoped and idempotent (re-running this migration
-- after a restore is a no-op because of the IS NULL guard).
UPDATE sales
   SET due_date = (transaction_date::date + INTERVAL '30 days')::date
 WHERE due_date IS NULL
   AND payment_status IN ('Credit', 'Partial')
   AND is_voided = FALSE;

-- Helpful index for the daily reminder cron, which scans by
-- (payment_status, due_date) every morning.
CREATE INDEX IF NOT EXISTS idx_sales_credit_due
    ON sales (payment_status, due_date)
    WHERE payment_status IN ('Credit', 'Partial') AND is_voided = FALSE;
