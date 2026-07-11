-- Recovery migration: restore the missing UUID conversion step recorded by
-- the May 21 local database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop early foreign keys so integer references can be converted safely. Later
-- migrations recreate the UUID-era constraints they rely on.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conrelid::regclass AS table_name, conname
        FROM pg_constraint
        WHERE contype = 'f'
          AND connamespace = 'public'::regnamespace
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.table_name, r.conname);
    END LOOP;
END $$;

-- Preserve seeded permissions and their role mappings while changing the
-- permission primary key from SERIAL to UUID.
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid();
UPDATE permissions SET id_uuid = gen_random_uuid() WHERE id_uuid IS NULL;

ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS permission_id_uuid UUID;
UPDATE role_permissions rp
SET permission_id_uuid = p.id_uuid
FROM permissions p
WHERE rp.permission_id = p.id;

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_pkey;
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_pkey;
ALTER TABLE role_permissions DROP COLUMN IF EXISTS permission_id;
ALTER TABLE permissions DROP COLUMN IF EXISTS id;
ALTER TABLE permissions RENAME COLUMN id_uuid TO id;
ALTER TABLE permissions ALTER COLUMN id SET NOT NULL;
ALTER TABLE permissions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE permissions ADD PRIMARY KEY (id);
ALTER TABLE role_permissions RENAME COLUMN permission_id_uuid TO permission_id;
ALTER TABLE role_permissions ALTER COLUMN permission_id SET NOT NULL;
ALTER TABLE role_permissions ADD PRIMARY KEY (role, permission_id);

-- Core UUID primary keys.
ALTER TABLE users ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE users ALTER COLUMN user_id TYPE UUID USING gen_random_uuid();
ALTER TABLE users ALTER COLUMN user_id SET DEFAULT gen_random_uuid();

ALTER TABLE customers ALTER COLUMN customer_id DROP DEFAULT;
ALTER TABLE customers ALTER COLUMN customer_id TYPE UUID USING gen_random_uuid();
ALTER TABLE customers ALTER COLUMN customer_id SET DEFAULT gen_random_uuid();

ALTER TABLE sales ALTER COLUMN sale_id DROP DEFAULT;
ALTER TABLE sales ALTER COLUMN sale_id TYPE UUID USING gen_random_uuid();
ALTER TABLE sales ALTER COLUMN sale_id SET DEFAULT gen_random_uuid();

ALTER TABLE quotes ALTER COLUMN quote_id DROP DEFAULT;
ALTER TABLE quotes ALTER COLUMN quote_id TYPE UUID USING gen_random_uuid();
ALTER TABLE quotes ALTER COLUMN quote_id SET DEFAULT gen_random_uuid();

-- References to UUID-era users, customers, sales, quotes, and free-form record
-- IDs. The recovered fresh database has no business rows at this point; using
-- NULL avoids invalid integer-to-UUID casts while preserving column intent.
ALTER TABLE sales ALTER COLUMN customer_id TYPE UUID USING NULL;
ALTER TABLE sales ALTER COLUMN staff_id TYPE UUID USING NULL;
ALTER TABLE sales ALTER COLUMN voided_by TYPE UUID USING NULL;

ALTER TABLE sale_items ALTER COLUMN sale_id TYPE UUID USING NULL;

ALTER TABLE job_cards ALTER COLUMN sale_id TYPE UUID USING NULL;
ALTER TABLE job_cards ALTER COLUMN customer_id TYPE UUID USING NULL;
ALTER TABLE job_cards ALTER COLUMN assigned_to TYPE UUID USING NULL;
ALTER TABLE job_cards ALTER COLUMN quote_id TYPE UUID USING NULL;

ALTER TABLE expenses ALTER COLUMN recorded_by TYPE UUID USING NULL;

ALTER TABLE audit_logs ALTER COLUMN user_id TYPE UUID USING NULL;
ALTER TABLE audit_logs ALTER COLUMN record_id TYPE VARCHAR(100) USING record_id::text;

ALTER TABLE purchase_orders ALTER COLUMN created_by TYPE UUID USING NULL;
ALTER TABLE purchase_orders ALTER COLUMN approved_by TYPE UUID USING NULL;

ALTER TABLE returns ALTER COLUMN original_sale_id TYPE UUID USING NULL;
ALTER TABLE returns ALTER COLUMN customer_id TYPE UUID USING NULL;
ALTER TABLE returns ALTER COLUMN processed_by TYPE UUID USING NULL;
ALTER TABLE returns ALTER COLUMN approved_by TYPE UUID USING NULL;

ALTER TABLE cash_sessions ALTER COLUMN opened_by TYPE UUID USING NULL;
ALTER TABLE cash_sessions ALTER COLUMN closed_by TYPE UUID USING NULL;

ALTER TABLE cash_movements ALTER COLUMN reference_id TYPE VARCHAR(100) USING reference_id::text;
ALTER TABLE cash_movements ALTER COLUMN performed_by TYPE UUID USING NULL;

ALTER TABLE quotes ALTER COLUMN customer_id TYPE UUID USING NULL;
ALTER TABLE quotes ALTER COLUMN converted_sale_id TYPE UUID USING NULL;
ALTER TABLE quotes ALTER COLUMN created_by TYPE UUID USING NULL;

ALTER TABLE job_costs ALTER COLUMN recorded_by TYPE UUID USING NULL;

ALTER TABLE promotions ALTER COLUMN created_by TYPE UUID USING NULL;

ALTER TABLE loyalty_transactions ALTER COLUMN customer_id TYPE UUID USING NULL;
ALTER TABLE loyalty_transactions ALTER COLUMN reference_id TYPE VARCHAR(100) USING reference_id::text;
ALTER TABLE loyalty_transactions ALTER COLUMN created_by TYPE UUID USING NULL;

ALTER TABLE store_credits ALTER COLUMN customer_id TYPE UUID USING NULL;
ALTER TABLE store_credits ALTER COLUMN source_id TYPE VARCHAR(100) USING source_id::text;
ALTER TABLE store_credits ALTER COLUMN created_by TYPE UUID USING NULL;

ALTER TABLE approval_requests ALTER COLUMN entity_id TYPE VARCHAR(100) USING entity_id::text;
ALTER TABLE approval_requests ALTER COLUMN requested_by TYPE UUID USING NULL;
ALTER TABLE approval_requests ALTER COLUMN approved_by TYPE UUID USING NULL;

ALTER TABLE notifications ALTER COLUMN user_id TYPE UUID USING NULL;
ALTER TABLE notifications ALTER COLUMN related_id TYPE VARCHAR(100) USING related_id::text;
