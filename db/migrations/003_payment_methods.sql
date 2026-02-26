-- Up Migration
CREATE TABLE IF NOT EXISTS payment_methods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(20) NOT NULL,
    -- 'cash', 'card', 'mobile', 'bank'
    is_active BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}',
    -- For any provider-specific settings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Add Reference Column to Sales
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
-- Seed Payment Methods
INSERT INTO payment_methods (name, type)
VALUES ('Cash', 'cash'),
    ('Airtel Money', 'mobile'),
    ('MTN Money', 'mobile'),
    ('Zamtel Money', 'mobile'),
    ('Zanaco', 'bank'),
    ('FNB', 'bank'),
    ('Stanbic', 'bank'),
    ('ABSA', 'bank'),
    ('POS / Swipe', 'card'),
    ('Cheque', 'bank') ON CONFLICT (name) DO NOTHING;