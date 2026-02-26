-- =====================================================
-- Zachi Smart-POS (Z-SPOS) - Initial Database Schema
-- Database: png_ccets (localhost) / png_ccets_dev (dev)
-- =====================================================
-- =====================================================
-- 1. USERS (Authentication & Staff)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL DEFAULT 'cashier',
    -- 'director', 'cashier', 'designer', 'consultant'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 2. PRODUCTS (Inventory & Physical Items)
-- =====================================================
CREATE TABLE IF NOT EXISTS products (
    product_id SERIAL PRIMARY KEY,
    barcode VARCHAR(50) UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    -- e.g., 'Stationery', 'ICT Hardware'
    unit_price DECIMAL(10, 2) NOT NULL,
    cost_price DECIMAL(10, 2),
    -- For profit margin calculation
    stock_quantity INT DEFAULT 0,
    reorder_level INT DEFAULT 10,
    -- Smart alert trigger
    unit_of_measure VARCHAR(20) DEFAULT 'piece',
    -- 'piece', 'ream', 'meter', 'roll'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 3. SERVICES (Custom Jobs & Service Definitions)
-- =====================================================
CREATE TABLE IF NOT EXISTS services (
    service_id SERIAL PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    -- e.g., 'Graphics', 'Consultancy', 'Printing'
    base_price DECIMAL(10, 2),
    unit_measure VARCHAR(20),
    -- e.g., 'per_page', 'per_hour', 'fixed'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 4. CUSTOMERS (CRM)
-- =====================================================
CREATE TABLE IF NOT EXISTS customers (
    customer_id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    company_name VARCHAR(150),
    t_pin VARCHAR(20),
    -- For ZRA Returns context
    customer_type VARCHAR(20) DEFAULT 'walk-in',
    -- 'walk-in', 'regular', 'corporate'
    loyalty_points INT DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 5. SALES (Transaction Header)
-- =====================================================
CREATE TABLE IF NOT EXISTS sales (
    sale_id SERIAL PRIMARY KEY,
    sale_number VARCHAR(20) UNIQUE,
    -- Human-readable: e.g., 'ZC-20260215-001'
    customer_id INT REFERENCES customers(customer_id) ON DELETE
    SET NULL,
        staff_id INT REFERENCES users(user_id),
        subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(10, 2) DEFAULT 0,
        -- Zambian VAT (16%)
        discount_amount DECIMAL(10, 2) DEFAULT 0,
        total_amount DECIMAL(10, 2) NOT NULL,
        payment_method VARCHAR(20) NOT NULL,
        -- 'Cash', 'Airtel_Money', 'MTN_Money', 'Bank'
        payment_status VARCHAR(20) DEFAULT 'Paid',
        -- 'Paid', 'Partial', 'Credit'
        amount_paid DECIMAL(10, 2) DEFAULT 0,
        change_due DECIMAL(10, 2) DEFAULT 0,
        notes TEXT,
        is_voided BOOLEAN DEFAULT FALSE,
        voided_by INT REFERENCES users(user_id),
        voided_at TIMESTAMP,
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 6. SALE_ITEMS (Line Items - hybrid cart support)
-- =====================================================
CREATE TABLE IF NOT EXISTS sale_items (
    item_id SERIAL PRIMARY KEY,
    sale_id INT NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    item_type VARCHAR(10) NOT NULL,
    -- 'product' or 'service'
    product_id INT REFERENCES products(product_id),
    service_id INT REFERENCES services(service_id),
    description VARCHAR(200),
    -- Override name for receipt
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    line_total DECIMAL(10, 2) NOT NULL,
    CONSTRAINT chk_item_type CHECK (
        (
            item_type = 'product'
            AND product_id IS NOT NULL
        )
        OR (
            item_type = 'service'
            AND service_id IS NOT NULL
        )
    )
);
-- =====================================================
-- 7. JOB CARDS (Production Tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS job_cards (
    job_id SERIAL PRIMARY KEY,
    job_number VARCHAR(20) UNIQUE,
    -- Human-readable: e.g., 'JOB-20260215-001'
    sale_id INT REFERENCES sales(sale_id),
    sale_item_id INT REFERENCES sale_items(item_id),
    service_id INT REFERENCES services(service_id),
    customer_id INT REFERENCES customers(customer_id),
    assigned_to INT REFERENCES users(user_id),
    -- Designer/Technician
    status VARCHAR(20) DEFAULT 'Pending',
    -- 'Pending', 'Designing', 'Printing', 'Completed', 'Collected'
    priority VARCHAR(10) DEFAULT 'Normal',
    -- 'Low', 'Normal', 'High', 'Urgent'
    specifications TEXT,
    -- e.g., "Glossy paper, 250gsm, Blue theme"
    deadline TIMESTAMP,
    file_attachment_url TEXT,
    -- Link to design files (Google Drive)
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 8. EXPENSES (Business Cost Tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS expenses (
    expense_id SERIAL PRIMARY KEY,
    category VARCHAR(50),
    -- 'Supplies', 'Utilities', 'Wages', 'Rent'
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    recorded_by INT REFERENCES users(user_id),
    expense_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- 9. AUDIT LOGS (Security & Compliance)
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id),
    action VARCHAR(100) NOT NULL,
    -- e.g., 'VOID_SALE', 'EDIT_STOCK', 'LOGIN'
    table_name VARCHAR(50),
    record_id INT,
    old_value TEXT,
    new_value TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- =====================================================
-- INDEXES (Performance Optimization)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_sales_transaction_date ON sales(transaction_date);
CREATE INDEX IF NOT EXISTS idx_sales_staff_id ON sales(staff_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_job_cards_status ON job_cards(status);
CREATE INDEX IF NOT EXISTS idx_job_cards_assigned_to ON job_cards(assigned_to);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
-- =====================================================
-- VIEWS (Smart Business Intelligence)
-- =====================================================
-- Daily Profit View
CREATE OR REPLACE VIEW v_daily_profit AS WITH daily_sales AS (
        SELECT COALESCE(SUM(total_amount), 0) AS revenue
        FROM sales
        WHERE transaction_date >= CURRENT_DATE
            AND is_voided = FALSE
    ),
    daily_expenses AS (
        SELECT COALESCE(SUM(amount), 0) AS costs
        FROM expenses
        WHERE expense_date = CURRENT_DATE
    )
SELECT revenue AS total_revenue,
    costs AS total_costs,
    (revenue - costs) AS net_profit
FROM daily_sales,
    daily_expenses;