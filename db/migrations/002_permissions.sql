-- Up Migration
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE role_permissions (
    role VARCHAR(50) NOT NULL,
    -- 'director', 'manager', 'cashier'
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role, permission_id)
);
-- Seed Permissions
INSERT INTO permissions (name, description)
VALUES -- Sales
    ('sale.create', 'Create new sales'),
    ('sale.view', 'View sales history'),
    ('sale.void', 'Void completed sales'),
    ('sale.refund', 'Process refunds'),
    -- Inventory
    ('inventory.view', 'View product inventory'),
    ('inventory.create', 'Add new products'),
    ('inventory.update', 'Edit existing products'),
    ('inventory.delete', 'Delete products'),
    ('inventory.import', 'Import inventory from CSV'),
    ('inventory.export', 'Export inventory to CSV'),
    ('inventory.low_stock', 'View low stock alerts'),
    -- Users
    ('user.view', 'View system users'),
    ('user.create', 'Create new users'),
    ('user.update', 'Edit user details'),
    ('user.delete', 'Delete users'),
    -- Reports
    (
        'report.view',
        'View financial and operational reports'
    ),
    -- Audit
    ('audit.view', 'View system audit logs');
-- Seed Default Role Permissions
-- Director (All Permissions)
INSERT INTO role_permissions (role, permission_id)
SELECT 'director',
    id
FROM permissions;
-- Manager
INSERT INTO role_permissions (role, permission_id)
SELECT 'manager',
    id
FROM permissions
WHERE name IN (
        'sale.create',
        'sale.view',
        'sale.void',
        'sale.refund',
        'inventory.view',
        'inventory.create',
        'inventory.update',
        'inventory.import',
        'inventory.export',
        'inventory.low_stock',
        'report.view'
    );
-- Cashier
INSERT INTO role_permissions (role, permission_id)
SELECT 'cashier',
    id
FROM permissions
WHERE name IN (
        'sale.create',
        'sale.view',
        'inventory.view',
        'inventory.low_stock'
    );