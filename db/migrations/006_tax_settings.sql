INSERT INTO system_settings (setting_key, setting_value, description)
VALUES (
        'tax.rate',
        '0.16',
        'Default VAT Rate (e.g., 0.16 for 16%)'
    ) ON CONFLICT (setting_key) DO NOTHING;