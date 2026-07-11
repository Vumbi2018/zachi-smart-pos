-- =====================================================
-- Migration 016: Store-info defaults + "Credit" payment method
-- =====================================================
-- 1. Seed store letterhead defaults into system_settings so the new
--    quote and receipt redesigns can pull a single source of truth.
--    Existing rows are left untouched (ON CONFLICT DO NOTHING).
-- 2. Seed a "Credit" entry in payment_methods so cashiers can sell on
--    account and trigger the partial-payment flow on the POS.
-- =====================================================

-- ---------- 1. Store letterhead defaults ----------
INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
    ('store.name',     '"Zachi Computer Centre"',                                                           'Trading name shown on receipts, quotes and PDFs'),
    ('store.tagline',  '"Enterprise Retail Management"',                                                    'Tagline / sub-line shown under the trading name'),
    ('store.address',  '"Near Coppers Corner, Independence Ave, Solwezi"',                                  'Street address shown on receipts, quotes and PDFs'),
    ('store.phone',    '"+260 974 210 067"',                                                                'Primary contact number'),
    ('store.email',    '"info@zachicomputercentre.com"',                                                    'Primary contact email'),
    ('store.website',  '"pos.zachicomputercentre.com"',                                                     'Website / portal URL'),
    ('store.tpin',     '""',                                                                                 'Tax Payer Identification Number (ZRA)'),
    ('store.logo_url', '"/logo.png"',                                                                       'Public path to the store logo (web-served)')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------- 2. Credit payment method ----------
INSERT INTO payment_methods (name, type)
VALUES ('Credit', 'credit')
ON CONFLICT (name) DO NOTHING;
