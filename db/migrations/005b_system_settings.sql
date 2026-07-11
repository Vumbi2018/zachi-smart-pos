-- Migration: Create system_settings table for feature flags
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(user_id)
);
-- Seed default settings
INSERT INTO system_settings (setting_key, setting_value, description)
VALUES (
        'modules.jobs',
        'true',
        'Enable Job Management module'
    ),
    (
        'modules.cash',
        'true',
        'Enable Cash Drawer module'
    ),
    (
        'modules.suppliers',
        'true',
        'Enable Suppliers module'
    ),
    (
        'modules.purchases',
        'true',
        'Enable Procurement/Purchasing module'
    ),
    (
        'modules.returns',
        'true',
        'Enable Returns module'
    ),
    ('modules.quotes', 'true', 'Enable Quotes module'),
    (
        'modules.loyalty',
        'true',
        'Enable Loyalty module'
    ) ON CONFLICT (setting_key) DO NOTHING;