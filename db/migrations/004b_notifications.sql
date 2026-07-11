DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
        AND tablename = 'notifications'
) THEN CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    -- 'status', 'approval', 'stock', etc.
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    related_id INTEGER,
    -- job_id, approval_id, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
END IF;
END $$;
-- Indexes (Postgres 9.5+ supports IF NOT EXISTS for indexes)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);