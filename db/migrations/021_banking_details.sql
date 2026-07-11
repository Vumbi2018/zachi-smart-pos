-- =====================================================
-- Migration 020: Banking + mobile-money details for invoices
-- =====================================================
-- v1.0.14 introduces a "Banking Details" card in Settings whose values
-- get rendered on:
--   * Invoice PDFs (between balance summary and footer, suppressed when
--     status = 'Paid')
--   * Invoice emails (HTML body)
--   * Invoice WhatsApp / SMS bodies
--
-- Receipts and quotes deliberately do NOT show banking details — they
-- are not "please pay" documents.
--
-- Existing rows are left untouched (ON CONFLICT DO NOTHING) so a
-- re-run on the live DB is a no-op. All values default to empty
-- strings; the renderers treat "all blank" as "skip the block".
-- =====================================================

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
    ('store.bank_name',         '""', 'Bank name (e.g. Zanaco, Stanbic) shown on invoice PDFs/emails'),
    ('store.bank_account_name', '""', 'Account holder / business name on the bank account'),
    ('store.bank_account_number','""', 'Bank account number'),
    ('store.bank_branch',       '""', 'Bank branch name'),
    ('store.bank_branch_code',  '""', 'Bank branch / sort code'),
    ('store.bank_swift',        '""', 'SWIFT / BIC code (for international transfers)'),
    ('store.momo_provider',     '""', 'Mobile-money provider (e.g. Airtel Money, MTN MoMo, Zamtel Kwacha)'),
    ('store.momo_number',       '""', 'Mobile-money account / wallet number')
ON CONFLICT (setting_key) DO NOTHING;
