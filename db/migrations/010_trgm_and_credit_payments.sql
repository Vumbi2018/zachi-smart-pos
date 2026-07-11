-- Migration 010: Enable pg_trgm for fuzzy product name matching + credit_payments table

-- Fuzzy matching for duplicate detection
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Track installment payments against credit/partial sales
CREATE TABLE IF NOT EXISTS credit_payments (
    payment_id       SERIAL PRIMARY KEY,
    sale_id          INTEGER NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method   VARCHAR(50)  NOT NULL DEFAULT 'Cash',
    payment_reference VARCHAR(100),
    notes            TEXT,
    recorded_by      INTEGER REFERENCES users(user_id),
    created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_payments_sale ON credit_payments(sale_id);
