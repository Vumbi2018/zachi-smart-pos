-- =====================================================
-- Zachi Smart-POS — Enterprise Skeleton Migration
-- Migration 004: All new enterprise module tables
-- =====================================================
-- =====================================================
-- SUPPLIERS
-- =====================================================
CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id SERIAL PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    -- 'COD', 'Net 15', 'Net 30', 'Net 60'
    tax_id VARCHAR(50),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS supplier_prices (
    id SERIAL PRIMARY KEY,
    supplier_id INT NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id),
    supplier_sku VARCHAR(50),
    unit_cost DECIMAL(10, 2) NOT NULL,
    moq INT DEFAULT 1,
    -- Minimum order quantity
    lead_time_days INT DEFAULT 7,
    is_preferred BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (supplier_id, product_id)
);
-- =====================================================
-- PURCHASE ORDERS & GOODS RECEIVED
-- =====================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
    po_id SERIAL PRIMARY KEY,
    po_number VARCHAR(30) UNIQUE,
    -- 'PO-20260216-001'
    supplier_id INT NOT NULL REFERENCES suppliers(supplier_id),
    status VARCHAR(20) DEFAULT 'Draft',
    -- 'Draft', 'Submitted', 'Partial', 'Received', 'Cancelled'
    order_date DATE DEFAULT CURRENT_DATE,
    expected_date DATE,
    subtotal DECIMAL(12, 2) DEFAULT 0,
    tax_amount DECIMAL(12, 2) DEFAULT 0,
    total_amount DECIMAL(12, 2) DEFAULT 0,
    notes TEXT,
    created_by INT REFERENCES users(user_id),
    approved_by INT REFERENCES users(user_id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS po_items (
    item_id SERIAL PRIMARY KEY,
    po_id INT NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id),
    quantity_ordered INT NOT NULL,
    quantity_received INT DEFAULT 0,
    unit_cost DECIMAL(10, 2) NOT NULL,
    line_total DECIMAL(12, 2) NOT NULL,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS goods_received (
    grn_id SERIAL PRIMARY KEY,
    grn_number VARCHAR(30) UNIQUE,
    -- 'GRN-20260216-001'
    po_id INT REFERENCES purchase_orders(po_id),
    supplier_id INT NOT NULL REFERENCES suppliers(supplier_id),
    received_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    received_by INT REFERENCES users(user_id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS grn_items (
    item_id SERIAL PRIMARY KEY,
    grn_id INT NOT NULL REFERENCES goods_received(grn_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id),
    po_item_id INT REFERENCES po_items(item_id),
    quantity_received INT NOT NULL,
    quantity_rejected INT DEFAULT 0,
    rejection_reason TEXT,
    unit_cost DECIMAL(10, 2) NOT NULL
);
-- =====================================================
-- INVENTORY MOVEMENTS (Immutable Ledger)
-- =====================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
    movement_id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(product_id),
    movement_type VARCHAR(30) NOT NULL,
    -- 'SALE', 'RETURN', 'GRN', 'ADJUSTMENT', 'TRANSFER', 'STOCKTAKE'
    quantity INT NOT NULL,
    -- Positive = in, negative = out
    reference_type VARCHAR(30),
    -- 'sale', 'grn', 'return', 'adjustment'
    reference_id INT,
    -- FK to the source record
    reason TEXT,
    balance_after INT,
    -- Running balance snapshot
    performed_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_type ON inventory_movements(movement_type);
-- =====================================================
-- STOCK ADJUSTMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
    adjustment_id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(product_id),
    adjustment_type VARCHAR(20) NOT NULL,
    -- 'increase', 'decrease', 'set'
    quantity INT NOT NULL,
    reason VARCHAR(50) NOT NULL,
    -- 'Damaged', 'Shrinkage', 'Count Correction', 'Other'
    notes TEXT,
    approved_by INT REFERENCES users(user_id),
    approved_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'Pending',
    -- 'Pending', 'Approved', 'Rejected'
    performed_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- RETURNS & EXCHANGES
-- =====================================================
CREATE TABLE IF NOT EXISTS returns (
    return_id SERIAL PRIMARY KEY,
    return_number VARCHAR(30) UNIQUE,
    -- 'RET-20260216-001'
    original_sale_id INT NOT NULL REFERENCES sales(sale_id),
    customer_id INT REFERENCES customers(customer_id),
    return_type VARCHAR(20) NOT NULL,
    -- 'refund', 'exchange', 'store_credit'
    status VARCHAR(20) DEFAULT 'Pending',
    -- 'Pending', 'Approved', 'Processed', 'Rejected'
    reason_code VARCHAR(50) NOT NULL,
    -- 'Defective', 'Wrong Item', 'Change of Mind', 'Not as Described'
    notes TEXT,
    refund_amount DECIMAL(10, 2) DEFAULT 0,
    refund_method VARCHAR(20),
    -- Original tender or store credit
    processed_by INT REFERENCES users(user_id),
    approved_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS return_items (
    item_id SERIAL PRIMARY KEY,
    return_id INT NOT NULL REFERENCES returns(return_id) ON DELETE CASCADE,
    original_item_id INT REFERENCES sale_items(item_id),
    product_id INT REFERENCES products(product_id),
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    line_total DECIMAL(10, 2) NOT NULL,
    restock BOOLEAN DEFAULT TRUE,
    -- Whether to add back to inventory
    condition VARCHAR(20) DEFAULT 'Good' -- 'Good', 'Damaged', 'Defective'
);
-- =====================================================
-- CASH DRAWER / SESSION MANAGEMENT
-- =====================================================
CREATE TABLE IF NOT EXISTS cash_sessions (
    session_id SERIAL PRIMARY KEY,
    session_date DATE DEFAULT CURRENT_DATE,
    opened_by INT NOT NULL REFERENCES users(user_id),
    closed_by INT REFERENCES users(user_id),
    opening_float DECIMAL(10, 2) NOT NULL DEFAULT 0,
    expected_cash DECIMAL(10, 2) DEFAULT 0,
    -- Calculated: float + cash sales - cash refunds
    actual_cash DECIMAL(10, 2),
    -- Counted at close
    variance DECIMAL(10, 2),
    -- Difference
    variance_reason TEXT,
    status VARCHAR(20) DEFAULT 'Open',
    -- 'Open', 'Closed', 'Reconciled'
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS cash_movements (
    movement_id SERIAL PRIMARY KEY,
    session_id INT REFERENCES cash_sessions(session_id),
    movement_type VARCHAR(20) NOT NULL,
    -- 'paid_in', 'paid_out', 'sale', 'refund', 'float'
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    reference_type VARCHAR(30),
    -- 'sale', 'return', 'expense'
    reference_id INT,
    performed_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- QUOTES / ESTIMATES
-- =====================================================
CREATE TABLE IF NOT EXISTS quotes (
    quote_id SERIAL PRIMARY KEY,
    quote_number VARCHAR(30) UNIQUE,
    -- 'QTE-20260216-001'
    customer_id INT REFERENCES customers(customer_id),
    status VARCHAR(20) DEFAULT 'Draft',
    -- 'Draft', 'Sent', 'Accepted', 'Declined', 'Expired', 'Converted'
    valid_until DATE,
    subtotal DECIMAL(12, 2) DEFAULT 0,
    tax_amount DECIMAL(12, 2) DEFAULT 0,
    discount_amount DECIMAL(12, 2) DEFAULT 0,
    total_amount DECIMAL(12, 2) DEFAULT 0,
    notes TEXT,
    converted_sale_id INT REFERENCES sales(sale_id),
    -- If accepted and converted to a sale
    created_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quote_items (
    item_id SERIAL PRIMARY KEY,
    quote_id INT NOT NULL REFERENCES quotes(quote_id) ON DELETE CASCADE,
    item_type VARCHAR(10) NOT NULL,
    -- 'product' or 'service'
    product_id INT REFERENCES products(product_id),
    service_id INT REFERENCES services(service_id),
    description VARCHAR(200),
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    line_total DECIMAL(10, 2) NOT NULL
);
-- =====================================================
-- JOB CARD EXTENSIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS job_proofs (
    proof_id SERIAL PRIMARY KEY,
    job_id INT NOT NULL REFERENCES job_cards(job_id) ON DELETE CASCADE,
    version INT DEFAULT 1,
    file_url TEXT,
    notes TEXT,
    status VARCHAR(20) DEFAULT 'Pending',
    -- 'Pending', 'Approved', 'Rejected', 'Revision'
    approved_by VARCHAR(150),
    -- Customer name (not always a system user)
    approved_at TIMESTAMP,
    uploaded_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_costs (
    cost_id SERIAL PRIMARY KEY,
    job_id INT NOT NULL REFERENCES job_cards(job_id) ON DELETE CASCADE,
    cost_type VARCHAR(30) NOT NULL,
    -- 'material', 'labour', 'machine_time', 'wastage', 'other'
    description VARCHAR(200),
    quantity DECIMAL(10, 2) DEFAULT 1,
    unit_cost DECIMAL(10, 2) NOT NULL,
    total_cost DECIMAL(10, 2) NOT NULL,
    recorded_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- PROMOTIONS & COUPONS
-- =====================================================
CREATE TABLE IF NOT EXISTS promotions (
    promo_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    discount_type VARCHAR(20) NOT NULL,
    -- 'percentage', 'fixed_amount', 'buy_x_get_y'
    discount_value DECIMAL(10, 2) NOT NULL,
    min_purchase DECIMAL(10, 2) DEFAULT 0,
    applies_to VARCHAR(20) DEFAULT 'all',
    -- 'all', 'category', 'product', 'service'
    applies_to_id INT,
    -- FK to product/service/category depending on scope
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coupons (
    coupon_id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    promo_id INT REFERENCES promotions(promo_id),
    max_uses INT DEFAULT 1,
    times_used INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- PRICE LISTS
-- =====================================================
CREATE TABLE IF NOT EXISTS price_lists (
    list_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    -- 'Retail', 'Wholesale', 'Staff', 'Corporate'
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS price_list_items (
    id SERIAL PRIMARY KEY,
    list_id INT NOT NULL REFERENCES price_lists(list_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id),
    price DECIMAL(10, 2) NOT NULL,
    min_quantity INT DEFAULT 1,
    -- For tiered pricing
    UNIQUE (list_id, product_id, min_quantity)
);
-- =====================================================
-- LOYALTY & STORE CREDITS
-- =====================================================
CREATE TABLE IF NOT EXISTS loyalty_tiers (
    tier_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    -- 'Bronze', 'Silver', 'Gold', 'Platinum'
    min_points INT DEFAULT 0,
    discount_pct DECIMAL(5, 2) DEFAULT 0,
    -- Auto-discount percentage
    points_multiplier DECIMAL(3, 2) DEFAULT 1.0,
    -- Earn rate multiplier
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    transaction_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(customer_id),
    transaction_type VARCHAR(20) NOT NULL,
    -- 'earn', 'redeem', 'adjust', 'expire'
    points INT NOT NULL,
    reference_type VARCHAR(30),
    -- 'sale', 'return', 'manual'
    reference_id INT,
    balance_after INT,
    notes TEXT,
    created_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS store_credits (
    credit_id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(customer_id),
    amount DECIMAL(10, 2) NOT NULL,
    balance DECIMAL(10, 2) NOT NULL,
    source VARCHAR(30) NOT NULL,
    -- 'return', 'loyalty_redeem', 'manual', 'promo'
    source_id INT,
    expires_at TIMESTAMP,
    created_by INT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- APPROVAL REQUESTS (Maker-Checker)
-- =====================================================
CREATE TABLE IF NOT EXISTS approval_requests (
    request_id SERIAL PRIMARY KEY,
    request_type VARCHAR(30) NOT NULL,
    -- 'discount', 'refund', 'stock_adjustment', 'price_change', 'void'
    entity_type VARCHAR(30),
    -- 'sale', 'product', 'return'
    entity_id INT,
    requested_by INT NOT NULL REFERENCES users(user_id),
    approved_by INT REFERENCES users(user_id),
    status VARCHAR(20) DEFAULT 'Pending',
    -- 'Pending', 'Approved', 'Rejected'
    details JSONB DEFAULT '{}',
    -- Context data for the request
    reason TEXT,
    decision_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP
);
-- =====================================================
-- PRODUCT EXTENSIONS (variants, attributes)
-- =====================================================
ALTER TABLE products
ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
ALTER TABLE products
ADD COLUMN IF NOT EXISTS sku VARCHAR(50);
ALTER TABLE products
ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products
ADD COLUMN IF NOT EXISTS weight DECIMAL(10, 3);
ALTER TABLE products
ADD COLUMN IF NOT EXISTS dimensions VARCHAR(50);
CREATE TABLE IF NOT EXISTS product_attributes (
    attribute_id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    attribute_name VARCHAR(50) NOT NULL,
    -- 'size', 'colour', 'gsm', 'finish'
    attribute_value VARCHAR(100) NOT NULL,
    UNIQUE (product_id, attribute_name)
);
CREATE TABLE IF NOT EXISTS product_bundles (
    bundle_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    bundle_price DECIMAL(10, 2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bundle_items (
    id SERIAL PRIMARY KEY,
    bundle_id INT NOT NULL REFERENCES product_bundles(bundle_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id),
    quantity INT NOT NULL DEFAULT 1
);
-- =====================================================
-- CUSTOMER EXTENSIONS
-- =====================================================
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS outstanding_balance DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS consent_marketing BOOLEAN DEFAULT FALSE;
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMP;
-- =====================================================
-- JOB CARD EXTENSIONS (additional columns)
-- =====================================================
ALTER TABLE job_cards
ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE job_cards
ADD COLUMN IF NOT EXISTS balance_due DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE job_cards
ADD COLUMN IF NOT EXISTS rush_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE job_cards
ADD COLUMN IF NOT EXISTS estimated_cost DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE job_cards
ADD COLUMN IF NOT EXISTS actual_cost DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE job_cards
ADD COLUMN IF NOT EXISTS quote_id INT REFERENCES quotes(quote_id);
-- =====================================================
-- ENTERPRISE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_date ON cash_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_job_proofs_job ON job_proofs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_costs_job ON job_costs(job_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer ON loyalty_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_store_credits_customer ON store_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_product_attrs ON product_attributes(product_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);