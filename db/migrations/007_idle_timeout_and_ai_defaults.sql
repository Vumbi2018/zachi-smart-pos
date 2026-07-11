-- Migration 007: Seed missing system_settings defaults
-- Add system.idle_timeout (30 minutes default) and AI config keys
INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
    ('system.idle_timeout', '30', 'Auto-logout after inactivity (minutes). Set to 0 to disable.'),
    ('ai.fraud_void_threshold', '3',  'Number of voids in 24h that triggers a fraud alert'),
    ('ai.after_hours_start',   '22', 'Hour (0-23) that "after-hours" trading starts'),
    ('ai.after_hours_end',     '6',  'Hour (0-23) that "after-hours" trading ends'),
    ('ai.inventory_alert_days','7',  'Alert when stock will run out within this many days')
ON CONFLICT (setting_key) DO NOTHING;
