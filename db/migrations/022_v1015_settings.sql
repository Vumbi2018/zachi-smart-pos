-- v1.0.15 settings tweaks:
--   1. Blank out the legacy "Enterprise Retail Management" tagline so it
--      stops appearing on PDFs, emails and the login screen. Operators
--      can re-enter their own tagline from Settings → Store Profile.
--   2. Seed two new optional secondary-contact keys (store.phone2,
--      store.email2) so PDFs / receipts can show "Tel: A | B" and
--      "Email: A | B" when the business publishes more than one number
--      or address. Empty by default — render path skips them when blank.

UPDATE system_settings
   SET setting_value = '""'::jsonb,
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key   = 'store.tagline'
   AND setting_value::text IN ('"Enterprise Retail Management"');

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
    ('store.phone2', '""', 'Optional secondary phone number shown on letterhead next to the primary'),
    ('store.email2', '""', 'Optional secondary email address shown on letterhead next to the primary')
ON CONFLICT (setting_key) DO NOTHING;
