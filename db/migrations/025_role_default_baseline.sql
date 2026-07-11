-- 025_role_default_baseline.sql
--
-- v1.0.29 — idempotent baseline reseed for the `cashier` and `designer`
-- roles, paired with the v1.0.29 routing changes that finally honour
-- per-user permission overrides on inventory and sale-create endpoints.
--
-- Purpose: make sure every install (fresh seed, partially-migrated
-- shop, or restored backup from 1.0.27) carries a sensible baseline
-- so the Users → Access tab shows a consistent grid for these roles
-- and the requirePermission() middleware has something to UNION
-- per-user grants on top of.
--
-- Notes:
--   • Cashier keeps `sale.create` as a role default (cashiers must be
--     able to ring up sales without a per-user grant).
--   • We do NOT grant `sale.create` to designer or `inventory.update` /
--     `inventory.import` to cashier/designer here — those remain
--     opt-in per user under Users → Access (the whole point of #56).
--   • Director short-circuits the resolver entirely, so no rows are
--     inserted for it.
--   • Every INSERT is `ON CONFLICT DO NOTHING` so re-running the
--     migration on a DB that already has 019/024 applied is a no-op.

-- Cashier baseline: ring sales, view inventory, see customers.
INSERT INTO role_permissions (role, permission_id)
SELECT 'cashier', id FROM permissions
WHERE name IN (
    'sale.create', 'sale.view',
    'inventory.view',
    'customer.view', 'customer.create',
    'service.view',
    'quote.view', 'quote.create',
    'invoice.view',
    'jobcard.view'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Designer baseline: job cards + read-only access to the things they
-- need to brief a job. They do NOT get sale.create or inventory.update
-- by default — directors grant those per user when needed.
INSERT INTO role_permissions (role, permission_id)
SELECT 'designer', id FROM permissions
WHERE name IN (
    'jobcard.view', 'jobcard.create', 'jobcard.update',
    'customer.view',
    'service.view',
    'inventory.view',
    'quote.view'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- Manager baseline: every cashier capability plus stock writes and
-- jobcard management. Director still bypasses the resolver entirely
-- so no rows are inserted for it.
INSERT INTO role_permissions (role, permission_id)
SELECT 'manager', id FROM permissions
WHERE name IN (
    'sale.create', 'sale.view', 'sale.void',
    'inventory.view', 'inventory.update', 'inventory.import', 'inventory.export',
    'customer.view', 'customer.create', 'customer.update',
    'service.view',
    'quote.view', 'quote.create', 'quote.send', 'quote.convert',
    'invoice.view', 'invoice.send', 'invoice.pay',
    'jobcard.view', 'jobcard.create', 'jobcard.update'
)
ON CONFLICT (role, permission_id) DO NOTHING;
