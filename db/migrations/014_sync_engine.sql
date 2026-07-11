-- =====================================================
-- Migration 014: Transaction Sync Engine
-- =====================================================
-- Adds the schema needed by the offline-first sync protocol:
--   * idempotency_keys: replay cache for mutating requests
--   * devices:          per-install registry (web PWA, Android, Windows)
--   * client_op_id / device_id columns on every mutating record so we
--     can trace each row back to the install that produced it
--   * audit_logs.device_id so the Director can see which counter (or
--     tablet) ran each action.
-- =====================================================

-- ── 1. idempotency_keys ──────────────────────────────────────────────
-- One row per accepted mutating request, keyed by the client-generated
-- UUID. The `request_hash` is a SHA-256 of (method|path|body) so that a
-- duplicate Idempotency-Key from a *different* request is rejected
-- rather than silently returning the wrong cached response.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             UUID PRIMARY KEY,
    endpoint        VARCHAR(255) NOT NULL,
    method          VARCHAR(10)  NOT NULL,
    request_hash    CHAR(64)     NOT NULL,
    status_code     INTEGER      NOT NULL,
    response_json   JSONB        NOT NULL,
    user_id         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    device_id       UUID,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at);

-- ── 2. devices ───────────────────────────────────────────────────────
-- Each install registers itself once and keeps the returned device_id
-- in localStorage. Keeps a "last seen" stamp so the director's
-- dashboard can flag tablets that haven't synced in a while.
CREATE TABLE IF NOT EXISTS devices (
    device_id    UUID PRIMARY KEY,
    user_id         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    platform     VARCHAR(40)  NOT NULL DEFAULT 'web',
    -- 'web', 'android', 'windows', 'ios', 'unknown'
    label        VARCHAR(100),
    user_agent   TEXT,
    last_seen_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
    created_at   TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- ── 3. failed_ops_log ────────────────────────────────────────────────
-- Mirror of the front-end failed_ops IndexedDB store so the Director
-- can see in the back office which sync ops were rejected by the
-- server (e.g. atomic stock guard tripped) without having to reach a
-- specific device.
CREATE TABLE IF NOT EXISTS failed_ops_log (
    id              SERIAL PRIMARY KEY,
    device_id       UUID,
    user_id         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    client_op_id    UUID,
    idempotency_key UUID,
    endpoint        VARCHAR(255) NOT NULL,
    method          VARCHAR(10)  NOT NULL,
    request_body    JSONB,
    error_code      VARCHAR(50),
    error_message   TEXT,
    queued_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_failed_ops_device ON failed_ops_log(device_id);
CREATE INDEX IF NOT EXISTS idx_failed_ops_created ON failed_ops_log(created_at);

-- ── 4. Per-row device + client_op_id columns ────────────────────────
-- Used to (a) prove provenance of every mutating record and (b) allow
-- a client to ask "did my op with client_op_id=X make it through?"
-- without relying solely on the idempotency cache.
ALTER TABLE sales                 ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE sales                 ADD COLUMN IF NOT EXISTS client_op_id UUID;
CREATE INDEX IF NOT EXISTS idx_sales_client_op ON sales(client_op_id);

ALTER TABLE credit_payments       ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE credit_payments       ADD COLUMN IF NOT EXISTS client_op_id UUID;

ALTER TABLE customers             ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE customers             ADD COLUMN IF NOT EXISTS client_op_id UUID;
ALTER TABLE customers             ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE loyalty_transactions  ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE loyalty_transactions  ADD COLUMN IF NOT EXISTS client_op_id UUID;

ALTER TABLE inventory_movements   ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE inventory_movements   ADD COLUMN IF NOT EXISTS client_op_id UUID;

ALTER TABLE stock_adjustments     ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE stock_adjustments     ADD COLUMN IF NOT EXISTS client_op_id UUID;

ALTER TABLE goods_received        ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE goods_received        ADD COLUMN IF NOT EXISTS client_op_id UUID;

ALTER TABLE audit_logs            ADD COLUMN IF NOT EXISTS device_id UUID;

-- ── 5. Server-side cursor for /api/sync/pull ─────────────────────────
-- Sales already have a transaction_date; products has updated_at; we
-- add a cheap updated_at trigger on customers so deltas can be served
-- consistently without reading every row.
CREATE OR REPLACE FUNCTION touch_customers_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_touch_updated_at ON customers;
CREATE TRIGGER trg_customers_touch_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION touch_customers_updated_at();
