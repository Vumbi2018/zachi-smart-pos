-- v1.0.13 — Invoices, per-user permission overrides, and an
-- expanded permissions catalogue.
--
-- The live dev/prod schemas use UUID for permissions.id,
-- role_permissions.permission_id, sales.sale_id, quotes.quote_id,
-- customers.customer_id, and users.user_id (despite earlier migrations
-- declaring SERIAL — the database was hand-rolled before migrations
-- existed). This migration declares all FKs as UUID accordingly. If you
-- start a brand-new database from migrations 001..018, run those with
-- the corresponding UUID overrides or convert the SERIAL columns first.

-- ─────────────────────────────────────────────────────────────────────
-- 1. INVOICES
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
    invoice_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number    VARCHAR(40) UNIQUE NOT NULL,

    -- Provenance: every invoice comes from either a credit sale or
    -- an accepted quote. Exactly one of source_sale_id /
    -- source_quote_id is set; partial UNIQUE indexes (below) make the
    -- "create invoice from this source" call safely idempotent so
    -- re-marking a quote Accepted or replaying a sale POST does not
    -- spawn a duplicate invoice.
    source_kind       VARCHAR(10) NOT NULL CHECK (source_kind IN ('sale','quote')),
    source_sale_id    UUID REFERENCES sales(sale_id)   ON DELETE SET NULL,
    source_quote_id   UUID REFERENCES quotes(quote_id) ON DELETE SET NULL,
    CONSTRAINT invoices_source_xor CHECK (
        (source_kind = 'sale'  AND source_sale_id  IS NOT NULL AND source_quote_id IS NULL) OR
        (source_kind = 'quote' AND source_quote_id IS NOT NULL AND source_sale_id  IS NULL)
    ),

    customer_id       UUID REFERENCES customers(customer_id) ON DELETE SET NULL,
    customer_name     VARCHAR(255),
    customer_phone    VARCHAR(50),
    customer_email    VARCHAR(255),
    customer_company  VARCHAR(255),

    subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_paid       NUMERIC(14,2) NOT NULL DEFAULT 0,
    balance_due       NUMERIC(14,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,

    -- Draft = editable; Issued = locked, awaiting payment;
    -- Paid    = balance_due == 0;
    -- Overdue = past due_date with balance > 0 (set by a job, optional);
    -- Void    = cancelled (non-destructive).
    status            VARCHAR(20) NOT NULL DEFAULT 'Draft'
                      CHECK (status IN ('Draft','Issued','Paid','Overdue','Void')),

    issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date          DATE,

    notes             TEXT,
    created_by        UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One invoice per source — partial unique to allow the NULL side.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_sale_uniq
    ON invoices (source_sale_id)
    WHERE source_sale_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_quote_uniq
    ON invoices (source_quote_id)
    WHERE source_quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx   ON invoices (status);
CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON invoices (due_date);
CREATE INDEX IF NOT EXISTS invoices_created_idx  ON invoices (created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_items (
    invoice_item_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id        UUID NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,

    -- 'product' | 'service' | 'custom' (free-text). Mirrors quote_items
    -- so the converter can copy 1:1.
    item_type         VARCHAR(20) NOT NULL DEFAULT 'product'
                      CHECK (item_type IN ('product','service','custom')),
    product_id        UUID,
    service_id        UUID,

    description       TEXT NOT NULL,
    quantity          NUMERIC(12,3) NOT NULL DEFAULT 1,
    unit_price        NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    line_total        NUMERIC(14,2) NOT NULL DEFAULT 0,

    sort_order        INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx
    ON invoice_items (invoice_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────
-- 2. PER-USER PERMISSION OVERRIDES
-- ─────────────────────────────────────────────────────────────────────
-- Effective permission set for a user is computed at request time as:
--   (role_default ∪ user_grant) − user_deny
-- A row with granted = TRUE adds the permission on top of the role;
-- a row with granted = FALSE removes it from the role.

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id         UUID NOT NULL REFERENCES users(user_id)        ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id)       ON DELETE CASCADE,
    granted         BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS user_permissions_user_idx
    ON user_permissions (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. EXPANDED PERMISSIONS CATALOGUE
-- ─────────────────────────────────────────────────────────────────────
-- Insert .view/.create/.update/.delete (and a few flavour-specific
-- extras) for every entity that didn't have permissions before.
-- ON CONFLICT (name) DO NOTHING is essential — name is UNIQUE and we
-- want this migration to be re-runnable (and to coexist with whatever
-- the prod DB already has).

INSERT INTO permissions (name, description) VALUES
    -- Quotes
    ('quote.view',     'View quotations'),
    ('quote.create',   'Create new quotations'),
    ('quote.update',   'Edit existing quotations'),
    ('quote.delete',   'Delete quotations'),
    ('quote.send',     'Email / WhatsApp / SMS a quotation to a customer'),
    ('quote.convert',  'Convert an accepted quotation into a sale'),

    -- Invoices
    ('invoice.view',   'View invoices'),
    ('invoice.create', 'Create invoices manually'),
    ('invoice.update', 'Edit invoices that are still in Draft'),
    ('invoice.delete', 'Void / delete invoices'),
    ('invoice.send',   'Email / WhatsApp / SMS an invoice to a customer'),
    ('invoice.pay',    'Record a payment against an invoice'),

    -- Customers
    ('customer.view',   'View customer records'),
    ('customer.create', 'Add new customers'),
    ('customer.update', 'Edit customer details'),
    ('customer.delete', 'Delete customers'),
    ('customer.export', 'Export customer list'),

    -- Services
    ('service.view',   'View service catalogue'),
    ('service.create', 'Create new services'),
    ('service.update', 'Edit existing services'),
    ('service.delete', 'Delete services'),

    -- Suppliers
    ('supplier.view',   'View suppliers'),
    ('supplier.create', 'Add new suppliers'),
    ('supplier.update', 'Edit supplier details'),
    ('supplier.delete', 'Delete suppliers'),

    -- Purchases / Stock receiving
    ('purchase.view',   'View purchase orders'),
    ('purchase.create', 'Create purchase orders / receive stock'),
    ('purchase.update', 'Edit purchase orders'),
    ('purchase.delete', 'Cancel purchase orders'),

    -- Returns
    ('return.view',   'View returns'),
    ('return.create', 'Create returns'),
    ('return.update', 'Edit returns'),
    ('return.delete', 'Cancel returns'),

    -- Job cards (if module enabled)
    ('jobcard.view',   'View job cards'),
    ('jobcard.create', 'Open new job cards'),
    ('jobcard.update', 'Edit / update job cards'),
    ('jobcard.delete', 'Cancel job cards'),

    -- Payments / credit
    ('payment.view',     'View customer payments'),
    ('payment.create',   'Record a payment'),
    ('payment.refund',   'Issue refunds against payments'),
    ('payment.adjust',   'Adjust outstanding balances'),

    -- Settings
    ('settings.view',   'View system settings'),
    ('settings.update', 'Modify system settings'),

    -- Permissions matrix
    ('permission.view',   'View role / user permission assignments'),
    ('permission.update', 'Modify role / user permissions'),

    -- Cash drawer / float
    ('cash.view',   'View cash drawer activity'),
    ('cash.update', 'Open / close / adjust cash drawer'),

    -- Promotions / loyalty
    ('promotion.view',   'View promotions'),
    ('promotion.create', 'Create promotions'),
    ('promotion.update', 'Edit promotions'),
    ('promotion.delete', 'Delete promotions'),
    ('loyalty.view',     'View loyalty programmes'),
    ('loyalty.update',   'Adjust loyalty points / programmes')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4. ROLE DEFAULTS FOR NEW PERMISSIONS
-- ─────────────────────────────────────────────────────────────────────
-- Director gets EVERYTHING (re-syncs even existing rows). The other
-- roles get a sensible subset — kept narrow so directors can use the
-- per-user override UI to widen access where needed.

INSERT INTO role_permissions (role, permission_id)
SELECT 'director', id FROM permissions
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'manager', id FROM permissions
WHERE name IN (
    'quote.view','quote.create','quote.update','quote.send',
    'invoice.view','invoice.create','invoice.update','invoice.send','invoice.pay',
    'customer.view','customer.create','customer.update','customer.export',
    'service.view',
    'supplier.view',
    'purchase.view','purchase.create','purchase.update',
    'return.view','return.create','return.update',
    'jobcard.view','jobcard.update',
    'payment.view','payment.create',
    'settings.view',
    'permission.view',
    'cash.view',
    'promotion.view',
    'loyalty.view','loyalty.update'
)
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'cashier', id FROM permissions
WHERE name IN (
    'quote.view','quote.create','quote.send','quote.convert',
    'invoice.view','invoice.send','invoice.pay',
    'customer.view','customer.create','customer.update',
    'service.view',
    'return.view','return.create',
    'payment.view','payment.create',
    'cash.view','cash.update',
    'loyalty.view'
)
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'designer', id FROM permissions
WHERE name IN (
    'jobcard.view','jobcard.create','jobcard.update',
    'customer.view',
    'service.view'
)
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'consultant', id FROM permissions
WHERE name IN (
    'quote.view','quote.create','quote.send',
    'customer.view','customer.create','customer.update',
    'service.view'
)
ON CONFLICT (role, permission_id) DO NOTHING;
