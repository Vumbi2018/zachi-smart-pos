-- =====================================================
-- 024: Proof file metadata + notifications.user_id widening
-- =====================================================
-- v1.0.22 — two related schema fixes for the job-card flow.
--
-- 1) job_proofs originally stored only `file_url` (a URL pasted by
--    a designer that pointed to Google Drive or similar). The new
--    "Choose file" flow uploads a real binary into Replit Object
--    Storage and we want to remember the original filename, mime
--    type and size so the UI can render proper download links and
--    file-type pills (PDF / image / etc.).
--
-- 2) Older installs ran 004b_notifications.sql back when
--    users.user_id was still SERIAL. Newer installs migrated
--    users.user_id to UUID, but the corresponding `notifications.user_id`
--    sometimes lagged behind, which silently dropped inserts on
--    installs where the types disagreed. Re-assert UUID on user_id
--    only — `related_id` is intentionally LEFT ALONE because some
--    callers (job_cards, sales, etc.) still pass integer IDs and we
--    must not break those inserts.
--
-- Both blocks are idempotent: ADD COLUMN IF NOT EXISTS, ALTER
-- COLUMN ... TYPE only when the type is wrong. Safe to re-run.
-- =====================================================

-- ── job_proofs: optional file metadata ────────────────────────
ALTER TABLE job_proofs ADD COLUMN IF NOT EXISTS file_name   VARCHAR(255);
ALTER TABLE job_proofs ADD COLUMN IF NOT EXISTS mime_type   VARCHAR(120);
ALTER TABLE job_proofs ADD COLUMN IF NOT EXISTS size_bytes  BIGINT;
ALTER TABLE job_proofs ADD COLUMN IF NOT EXISTS object_path TEXT;
-- object_path is the bucket-relative path of the uploaded blob
-- (so we can re-issue download URLs / move buckets later without
-- relying on the cached file_url being valid).

-- ── notifications: ensure UUID on the keys ────────────────────
DO $$
DECLARE
    users_pk_type text;
    notif_user_id_type text;
BEGIN
    SELECT data_type INTO users_pk_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'user_id';

    -- Only act if users.user_id is uuid; otherwise this is a fresh
    -- install on the legacy SERIAL schema and we leave it alone.
    IF users_pk_type IS NULL OR users_pk_type <> 'uuid' THEN
        RETURN;
    END IF;

    SELECT data_type INTO notif_user_id_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'notifications'
       AND column_name = 'user_id';

    IF notif_user_id_type IS NOT NULL AND notif_user_id_type <> 'uuid' THEN
        -- Non-destructive conversion. The legacy SERIAL user_id values
        -- can't be deterministically mapped to the new UUID users.user_id
        -- (the int->uuid mapping was lost when users were migrated), so
        -- we preserve every notification row but null out user_id where
        -- a mapping cannot be recovered. The FK is ON DELETE CASCADE +
        -- nullable, so this leaves orphaned-but-readable history. New
        -- inserts (which already pass UUIDs) work immediately.
        --
        -- Strategy: add user_id_uuid, attempt a best-effort backfill
        -- via users.legacy_id if that column exists (older converters
        -- preserved the int PK there), then swap.
        EXECUTE 'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id_uuid UUID';

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'users'
               AND column_name = 'legacy_id'
        ) THEN
            EXECUTE 'UPDATE notifications n SET user_id_uuid = u.user_id '
                 || '  FROM users u '
                 || ' WHERE u.legacy_id = n.user_id::int '
                 || '   AND n.user_id_uuid IS NULL';
        END IF;

        EXECUTE 'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey';
        EXECUTE 'ALTER TABLE notifications DROP COLUMN user_id';
        EXECUTE 'ALTER TABLE notifications RENAME COLUMN user_id_uuid TO user_id';
        EXECUTE 'ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey '
             || 'FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read)';
    END IF;

    -- NOTE: notifications.related_id and notifications.id are NOT
    -- widened here. Several callers (job_cards, sales, …) still pass
    -- integer IDs as related_id; converting the column would break
    -- those inserts. The live DB already has these as UUID via an
    -- earlier manual conversion, so leaving the column alone is a
    -- no-op there too.
END $$;
