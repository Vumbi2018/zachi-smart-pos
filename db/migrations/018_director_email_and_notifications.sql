-- =====================================================
-- 018: Director email correction + notification recipients
-- =====================================================
-- v1.0.4 hotfix: the prior placeholder director email
-- (director@zachi.co.zm) was being used for low-stock and
-- credit-reminder emails. Update existing seeded row to the
-- real Zachi inbox so directors actually receive the alerts.
--
-- Idempotent: only updates the seeded "director" username and
-- only when it still has the old placeholder address.
UPDATE users
   SET email = 'zachicomputercentre120@gmail.com'
 WHERE username = 'director'
   AND email IN ('director@zachi.co.zm', 'director@zachi.com', '');

-- Seed an empty notification-recipients list so the
-- Settings → Notification Recipients UI has a key to read/write.
-- Stored as a JSON array of {email, name} objects in system_settings.
INSERT INTO system_settings (setting_key, setting_value, description)
VALUES (
    'notifications.recipients',
    '[]'::jsonb,
    'Extra email recipients for low-stock and credit-due alerts. Director users with an email are always included automatically.'
)
ON CONFLICT (setting_key) DO NOTHING;
