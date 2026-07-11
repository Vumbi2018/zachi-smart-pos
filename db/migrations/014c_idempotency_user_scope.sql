-- =====================================================
-- Migration 014c: Tenant-safe idempotency keys
-- =====================================================
-- The original 014 made the idempotency cache key globally unique:
--
--     CREATE TABLE idempotency_keys (key UUID PRIMARY KEY, ...)
--
-- That is a security flaw. If user A's tablet POSTs `Idempotency-Key
-- = X`, the cache row records user A's response. Then if user B (a
-- different cashier on a different tablet) happens to reuse the
-- header value `X` — by coincidence (UUID collision is vanishingly
-- unlikely but not impossible) or by hostile retransmission — the
-- middleware would replay user A's response to user B. That is
-- cross-user data leakage.
--
-- Fix: scope the cache to (key, user_id). NULL user_id is reserved
-- for unauthenticated paths (none today) and is also distinct
-- per-NULL via COALESCE so two anonymous calls collide only if they
-- truly came from the same logical "actor" (we use 0 as the
-- sentinel).
-- =====================================================

ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_pkey;

-- Composite unique index that treats unauthenticated (NULL user_id)
-- as a single shared bucket via COALESCE; authenticated requests
-- always get per-user isolation.
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_key_user_uidx
    ON idempotency_keys (key, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON INDEX idempotency_keys_key_user_uidx IS
    'Tenant-safe idempotency uniqueness. The middleware looks up by '
    '(key, user_id IS NOT DISTINCT FROM $user) and inserts with '
    'ON CONFLICT (key, COALESCE(user_id,0)) DO NOTHING.';
