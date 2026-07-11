-- Per-user soft account lockout state.
-- Adds first-class lockout columns so login lockout no longer relies
-- solely on counting LOGIN_FAILED rows in audit_logs (which is kept
-- as a complementary audit trail). Idempotent: ADD COLUMN IF NOT EXISTS.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_users_locked_until
    ON users (locked_until) WHERE locked_until IS NOT NULL;
