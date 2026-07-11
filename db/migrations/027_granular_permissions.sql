-- v1.0.33 — Granular permissions expansion.
--
-- The existing catalogue (002 + 019) is broad: "sale.create" covers
-- ringing a sale, applying any discount, overriding any price, and
-- selling on credit. Directors asked for finer control so they can
-- give a cashier sale.create but withhold sale.discount or
-- sale.price_override.
--
-- Strategy:
--   1. Keep every legacy permission unchanged (back-compat — existing
--      grants/denies and middleware checks keep working).
--   2. Add fine-grained child permissions alongside the broad ones.
--   3. Seed sensible role defaults so existing roles don't suddenly
--      lose capability; directors can then narrow / widen per user via
--      the Access tab on the Edit User modal.
--
-- The Access tab UI reads from `permissions` automatically so every
-- new row below shows up as a tickable checkbox the moment this
-- migration runs.

INSERT INTO permissions (name, description) VALUES
    -- ── Sales (granular) ────────────────────────────────────────────
    ('sale.discount',         'Apply a discount on a sale (line or total)'),
    ('sale.discount_unlimited','Apply discounts beyond the configured cap'),
    ('sale.price_override',   'Change a line item unit price during sale'),
    ('sale.cancel',           'Cancel a sale in progress (before completion)'),
    ('sale.reprint',          'Reprint a completed receipt'),
    ('sale.export',           'Export sales history to CSV / PDF'),
    ('sale.credit',           'Sell on credit (increase customer balance)'),
    ('sale.backdate',         'Change the transaction date on a sale'),
    ('sale.split_tender',     'Pay one sale with multiple methods'),
    ('sale.return_no_receipt','Process a return without an original receipt'),

    -- ── Inventory (granular) ────────────────────────────────────────
    ('inventory.adjust_stock','Adjust stock quantity manually (with reason)'),
    ('inventory.transfer',    'Transfer stock between locations'),
    ('inventory.set_cost',    'Modify cost prices'),
    ('inventory.set_price',   'Modify selling prices'),
    ('inventory.view_cost',   'View cost prices (not just selling)'),
    ('inventory.view_margin', 'View profit margins'),
    ('inventory.barcode_print','Print barcode labels'),
    ('inventory.bulk_edit',   'Bulk edit multiple products at once'),
    ('inventory.category_manage','Create / rename / delete categories'),
    ('inventory.archive',     'Archive / unarchive products'),

    -- ── Customers (granular) ───────────────────────────────────────
    ('customer.merge',        'Merge duplicate customer records'),
    ('customer.credit_set_limit','Set / change a customer credit limit'),
    ('customer.balance_adjust','Adjust a customer outstanding balance'),
    ('customer.import',       'Import customers from CSV'),
    ('customer.view_balance', 'View customer outstanding balance'),
    ('customer.view_history', 'View customer purchase history'),

    -- ── Reports (granular) ─────────────────────────────────────────
    ('report.sales',          'View sales reports'),
    ('report.inventory',      'View inventory reports'),
    ('report.financial',      'View financial / P&L reports'),
    ('report.profit',         'View profit / margin reports'),
    ('report.cash',           'View cash drawer / shift reports'),
    ('report.tax',            'View tax / VAT reports'),
    ('report.customer',       'View customer reports (debt, top buyers)'),
    ('report.audit',          'View audit log reports'),
    ('report.export',         'Export reports to PDF / CSV / Excel'),

    -- ── Cash drawer (granular) ─────────────────────────────────────
    ('cash.open',             'Open the cash drawer manually'),
    ('cash.close_shift',      'Close the shift and reconcile drawer'),
    ('cash.payout',           'Record a cash payout / expense'),
    ('cash.float_set',        'Set the opening float'),
    ('cash.deposit',          'Record a cash deposit to bank'),
    ('cash.discrepancy_approve','Approve cash discrepancies on shift close'),

    -- ── Settings (granular) ────────────────────────────────────────
    ('settings.tax',          'Modify tax / VAT rates'),
    ('settings.printer',      'Configure receipt and label printers'),
    ('settings.business_profile','Edit business name, logo, contact details'),
    ('settings.banking',      'Edit banking details shown on invoices'),
    ('settings.integrations', 'Configure third-party integrations'),
    ('settings.security',     'Edit security / password policy settings'),
    ('settings.system',       'Edit advanced / system-level settings'),

    -- ── Users (granular) ───────────────────────────────────────────
    ('user.reset_password',   'Reset another user password'),
    ('user.disable',          'Enable / disable user accounts'),
    ('user.assign_role',      'Change a user role'),
    ('user.assign_permission','Grant or revoke individual permissions per user'),

    -- ── Payments (granular by method) ──────────────────────────────
    ('payment.cash',          'Accept cash payments'),
    ('payment.mobile_money',  'Accept mobile money (MTN / Airtel / Zamtel)'),
    ('payment.card',          'Accept card payments'),
    ('payment.cheque',        'Accept cheque payments'),
    ('payment.bank_transfer', 'Record bank transfer payments'),
    ('payment.write_off',     'Write off bad debt'),

    -- ── Backup / restore ───────────────────────────────────────────
    ('backup.create',         'Trigger a manual backup'),
    ('backup.download',       'Download backup files'),
    ('backup.restore',        'Restore from a backup (destructive)'),

    -- ── Returns (granular) ─────────────────────────────────────────
    ('return.approve',        'Approve a refund payout'),
    ('return.exchange',       'Process an exchange (no cash refund)'),
    ('return.cash_refund',    'Issue a cash refund on return'),

    -- ── Invoices (granular) ────────────────────────────────────────
    ('invoice.cancel',        'Cancel / void an issued invoice'),
    ('invoice.write_off',     'Write off an invoice as bad debt'),
    ('invoice.discount',      'Apply a discount on an invoice'),

    -- ── Job cards (granular) ───────────────────────────────────────
    ('jobcard.assign',        'Assign a job card to a designer / technician'),
    ('jobcard.complete',      'Mark a job card complete'),
    ('jobcard.invoice',       'Convert a completed job card into an invoice'),
    ('jobcard.estimate',      'Set / change the estimate on a job card'),

    -- ── Devices ────────────────────────────────────────────────────
    ('device.view',           'View registered devices / tills'),
    ('device.deregister',     'Deregister a device'),
    ('device.rename',         'Rename a device'),

    -- ── Notifications ──────────────────────────────────────────────
    ('notification.broadcast','Send a broadcast notification to staff'),
    ('notification.mark_all_read','Mark all notifications as read for everyone')
ON CONFLICT (name) DO NOTHING;

-- ── Role defaults ─────────────────────────────────────────────────
-- Director: gets every new permission.
INSERT INTO role_permissions (role, permission_id)
SELECT 'director', id FROM permissions
ON CONFLICT (role, permission_id) DO NOTHING;

-- Manager: trusted but not a super-user. No backup.restore,
-- no settings.business_profile, no settings.system, no
-- sale.discount_unlimited, no user.assign_role.
INSERT INTO role_permissions (role, permission_id)
SELECT 'manager', id FROM permissions
WHERE name IN (
    'sale.discount','sale.price_override','sale.cancel','sale.reprint',
    'sale.export','sale.credit','sale.split_tender','sale.return_no_receipt',
    'inventory.adjust_stock','inventory.transfer','inventory.set_cost',
    'inventory.set_price','inventory.view_cost','inventory.view_margin',
    'inventory.barcode_print','inventory.bulk_edit','inventory.category_manage',
    'inventory.archive',
    'customer.merge','customer.credit_set_limit','customer.balance_adjust',
    'customer.import','customer.view_balance','customer.view_history',
    'report.sales','report.inventory','report.financial','report.profit',
    'report.cash','report.tax','report.customer','report.audit','report.export',
    'cash.open','cash.close_shift','cash.payout','cash.float_set',
    'cash.deposit','cash.discrepancy_approve',
    'settings.tax','settings.printer','settings.banking','settings.security',
    'user.reset_password','user.disable','user.assign_permission',
    'payment.cash','payment.mobile_money','payment.card','payment.cheque',
    'payment.bank_transfer','payment.write_off',
    'backup.create','backup.download',
    'return.approve','return.exchange','return.cash_refund',
    'invoice.cancel','invoice.discount',
    'jobcard.assign','jobcard.complete','jobcard.invoice','jobcard.estimate',
    'device.view','device.rename',
    'notification.broadcast','notification.mark_all_read'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Cashier: ring sales, accept common tenders, basic customer ops.
-- NO discount / price_override / credit / cost visibility — director
-- can grant those per user via the Access tab when they trust someone.
INSERT INTO role_permissions (role, permission_id)
SELECT 'cashier', id FROM permissions
WHERE name IN (
    'sale.reprint','sale.split_tender',
    'inventory.barcode_print',
    'customer.view_balance','customer.view_history',
    'cash.open','cash.payout',
    'payment.cash','payment.mobile_money','payment.card',
    'return.exchange',
    'jobcard.estimate'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Designer: job-card focused.
INSERT INTO role_permissions (role, permission_id)
SELECT 'designer', id FROM permissions
WHERE name IN (
    'customer.view_history',
    'jobcard.assign','jobcard.complete','jobcard.estimate'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Consultant: quote-focused; can view customer history to scope work.
INSERT INTO role_permissions (role, permission_id)
SELECT 'consultant', id FROM permissions
WHERE name IN (
    'customer.view_history','customer.view_balance',
    'sale.reprint'
)
ON CONFLICT (role, permission_id) DO NOTHING;
