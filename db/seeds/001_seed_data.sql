-- =====================================================
-- Zachi Smart-POS - Seed Data
-- =====================================================
-- Default Director account (password: admin123)
-- bcrypt hash generated for 'admin123'
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES (
        'director',
        '$2b$10$03mcghDI0yeq0we.r1dGcOicpq7pci9IRHPJpAMwKvN0YSPgh1NZC',
        'Zachi Director',
        'zachicomputercentre120@gmail.com',
        'director'
    ) ON CONFLICT (username) DO UPDATE 
    SET password_hash = '$2b$10$03mcghDI0yeq0we.r1dGcOicpq7pci9IRHPJpAMwKvN0YSPgh1NZC',
        email = 'zachicomputercentre120@gmail.com';

-- Default Cashier account (password: cashier123)
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES (
        'cashier1',
        '$2b$10$DhklCRQzCH4CIzywtuZh0OC/wcVnygl2Zqo7WIBRyXL18PRSxstu.',
        'Front Desk Cashier',
        'cashier@zachi.co.zm',
        'cashier'
    ) ON CONFLICT (username) DO UPDATE 
    SET password_hash = '$2b$10$DhklCRQzCH4CIzywtuZh0OC/wcVnygl2Zqo7WIBRyXL18PRSxstu.';

-- Default Designer account (password: designer123)
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES (
        'designer1',
        '$2b$10$Y5ccNMKlHQTJYxfdDbRavOCOvW7t0NwdUlPD7HDdvtb4P/liqm7Ye',
        'Lead Graphic Designer',
        'designer@zachi.co.zm',
        'designer'
    ) ON CONFLICT (username) DO UPDATE 
    SET password_hash = '$2b$10$Y5ccNMKlHQTJYxfdDbRavOCOvW7t0NwdUlPD7HDdvtb4P/liqm7Ye';
-- =====================================================
-- SERVICES (Zachi offerings)
-- =====================================================
INSERT INTO services (service_name, category, base_price, unit_measure)
VALUES (
        'Photocopy B&W (A4)',
        'Printing',
        1.00,
        'per_page'
    ),
    (
        'Photocopy Color (A4)',
        'Printing',
        5.00,
        'per_page'
    ),
    (
        'Photocopy B&W (A3)',
        'Printing',
        2.00,
        'per_page'
    ),
    (
        'Photocopy Color (A3)',
        'Printing',
        10.00,
        'per_page'
    ),
    (
        'Lamination (A4)',
        'Printing',
        15.00,
        'per_page'
    ),
    (
        'Lamination (A3)',
        'Printing',
        25.00,
        'per_page'
    ),
    (
        'Binding (Spiral)',
        'Printing',
        20.00,
        'per_item'
    ),
    (
        'Binding (Hard Cover)',
        'Printing',
        50.00,
        'per_item'
    ),
    (
        'Poster Design',
        'Graphics',
        150.00,
        'fixed'
    ),
    (
        'Banner Design',
        'Graphics',
        200.00,
        'fixed'
    ),
    (
        'Flyer Design',
        'Graphics',
        100.00,
        'fixed'
    ),
    (
        'Business Card Design',
        'Graphics',
        80.00,
        'fixed'
    ),
    (
        'Logo Design',
        'Graphics',
        500.00,
        'fixed'
    ),
    (
        'Wedding Card Design',
        'Graphics',
        300.00,
        'fixed'
    ),
    (
        'Banner Printing (Per M²)',
        'Printing',
        80.00,
        'per_meter'
    ),
    (
        'T-Shirt Printing',
        'Graphics',
        50.00,
        'per_item'
    ),
    (
        'Car Branding',
        'Graphics',
        1500.00,
        'fixed'
    ),
    (
        'Embroidery',
        'Graphics',
        100.00,
        'per_item'
    ),
    (
        'Invoice/Receipt Book',
        'Printing',
        120.00,
        'per_item'
    ),
    (
        'ZRA Return Filing',
        'Consultancy',
        200.00,
        'fixed'
    ),
    (
        'PACRA Annual Return',
        'Consultancy',
        350.00,
        'fixed'
    ),
    (
        'Company Registration',
        'Consultancy',
        1500.00,
        'fixed'
    ),
    (
        'ICT Consultancy',
        'Consultancy',
        300.00,
        'per_hour'
    ),
    (
        'ID Printing',
        'Printing',
        30.00,
        'per_item'
    ),
    (
        'Passport Photo',
        'Printing',
        20.00,
        'per_item'
    ) ON CONFLICT DO NOTHING;
-- =====================================================
-- SAMPLE PRODUCTS (Stationery & ICT Hardware)
-- =====================================================
INSERT INTO products (
        barcode,
        name,
        category,
        unit_price,
        cost_price,
        stock_quantity,
        reorder_level,
        unit_of_measure
    )
VALUES (
        '8901234567890',
        'A4 Paper Ream (500 sheets)',
        'Stationery',
        45.00,
        35.00,
        100,
        20,
        'ream'
    ),
    (
        '8901234567891',
        'A3 Paper Ream (500 sheets)',
        'Stationery',
        90.00,
        70.00,
        30,
        10,
        'ream'
    ),
    (
        '8901234567892',
        'Ballpoint Pen (Blue)',
        'Stationery',
        3.00,
        1.50,
        200,
        50,
        'piece'
    ),
    (
        '8901234567893',
        'Ballpoint Pen (Black)',
        'Stationery',
        3.00,
        1.50,
        200,
        50,
        'piece'
    ),
    (
        '8901234567894',
        'HB Pencil',
        'Stationery',
        2.00,
        0.80,
        300,
        50,
        'piece'
    ),
    (
        '8901234567895',
        'Eraser',
        'Stationery',
        2.50,
        1.00,
        150,
        30,
        'piece'
    ),
    (
        '8901234567896',
        'Ruler (30cm)',
        'Stationery',
        5.00,
        2.50,
        100,
        20,
        'piece'
    ),
    (
        '8901234567897',
        'Stapler',
        'Stationery',
        25.00,
        15.00,
        40,
        10,
        'piece'
    ),
    (
        '8901234567898',
        'Staple Pins (Box)',
        'Stationery',
        8.00,
        4.00,
        80,
        20,
        'box'
    ),
    (
        '8901234567899',
        'Correction Fluid',
        'Stationery',
        10.00,
        5.00,
        60,
        15,
        'piece'
    ),
    (
        '8901234568900',
        'Glue Stick',
        'Stationery',
        8.00,
        3.50,
        80,
        20,
        'piece'
    ),
    (
        '8901234568901',
        'Toner Cartridge (Black)',
        'ICT Hardware',
        350.00,
        250.00,
        10,
        3,
        'piece'
    ),
    (
        '8901234568902',
        'Toner Cartridge (Color)',
        'ICT Hardware',
        500.00,
        380.00,
        8,
        3,
        'piece'
    ),
    (
        '8901234568903',
        'USB Flash Drive 16GB',
        'ICT Hardware',
        50.00,
        30.00,
        25,
        5,
        'piece'
    ),
    (
        '8901234568904',
        'USB Flash Drive 32GB',
        'ICT Hardware',
        80.00,
        50.00,
        20,
        5,
        'piece'
    ),
    (
        '8901234568905',
        'Mouse (USB)',
        'ICT Hardware',
        45.00,
        25.00,
        30,
        5,
        'piece'
    ),
    (
        '8901234568906',
        'Keyboard (USB)',
        'ICT Hardware',
        65.00,
        40.00,
        20,
        5,
        'piece'
    ),
    (
        '8901234568907',
        'HDMI Cable (1.5m)',
        'ICT Hardware',
        35.00,
        18.00,
        15,
        5,
        'piece'
    ),
    (
        '8901234568908',
        'Glossy Photo Paper (20 Pack)',
        'Stationery',
        40.00,
        25.00,
        50,
        10,
        'pack'
    ),
    (
        '8901234568909',
        'Banner Vinyl Roll (50m)',
        'Stationery',
        800.00,
        600.00,
        5,
        2,
        'roll'
    ) ON CONFLICT (barcode) DO NOTHING;
-- =====================================================
-- SAMPLE CUSTOMER
-- =====================================================
INSERT INTO customers (full_name, phone, company_name, customer_type)
VALUES ('Walk-in Customer', NULL, NULL, 'walk-in') ON CONFLICT DO NOTHING;
INSERT INTO customers (full_name, phone, email, company_name, customer_type, loyalty_points)
VALUES
    ('John Mwale',    '+260971234567', 'jmwale@gmail.com',   NULL,                 'retail',     50),
    ('Charity Banda', '+260966543210', NULL,                  'Banda Enterprises',  'corporate', 120),
    ('Peter Phiri',   '+260977890123', 'pphiri@zmail.co.zm', NULL,                 'retail',     30)
ON CONFLICT DO NOTHING;

-- =====================================================
-- SAMPLE SALES (realistic historical data for dashboard)
-- IDs resolved via sub-selects for portability
-- =====================================================
DO $$
DECLARE
    v_director_id   INT;
    v_cashier_id    INT;
    v_walkin_id     INT;
    v_john_id       INT;
    v_paper_id      INT;  -- A4 Paper Ream
    v_pen_blue_id   INT;  -- Ballpoint Pen Blue
    v_pencil_id     INT;  -- HB Pencil
    v_stapler_id    INT;  -- Stapler
    v_usb16_id      INT;  -- USB 16GB
    v_toner_b_id    INT;  -- Toner Black
    v_poster_svc_id INT;  -- Poster Design service
    v_photocopy_id  INT;  -- Photocopy B&W A4 service
    v_sale_id       INT;
    v_balance       INT;
BEGIN
    -- Resolve user IDs
    SELECT user_id INTO v_director_id FROM users WHERE username = 'director';
    SELECT user_id INTO v_cashier_id  FROM users WHERE username = 'cashier1';

    -- Resolve customer IDs
    SELECT customer_id INTO v_walkin_id FROM customers WHERE full_name = 'Walk-in Customer' LIMIT 1;
    SELECT customer_id INTO v_john_id   FROM customers WHERE full_name = 'John Mwale'        LIMIT 1;

    -- Resolve product IDs
    SELECT product_id INTO v_paper_id   FROM products WHERE name ILIKE 'A4 Paper Ream%'        LIMIT 1;
    SELECT product_id INTO v_pen_blue_id FROM products WHERE name ILIKE 'Ballpoint Pen (Blue)%' LIMIT 1;
    SELECT product_id INTO v_pencil_id  FROM products WHERE name ILIKE 'HB Pencil%'            LIMIT 1;
    SELECT product_id INTO v_stapler_id FROM products WHERE name ILIKE 'Stapler%'              LIMIT 1;
    SELECT product_id INTO v_usb16_id   FROM products WHERE name ILIKE 'USB Flash Drive 16GB%' LIMIT 1;
    SELECT product_id INTO v_toner_b_id FROM products WHERE name ILIKE 'Toner Cartridge (Black)%' LIMIT 1;

    -- Resolve service IDs
    SELECT service_id INTO v_poster_svc_id FROM services WHERE service_name ILIKE 'Poster Design%'         LIMIT 1;
    SELECT service_id INTO v_photocopy_id   FROM services WHERE service_name ILIKE 'Photocopy B&W (A4)%'   LIMIT 1;

    -- Skip if essential data is missing (e.g. first-time run without products)
    IF v_director_id IS NULL OR v_paper_id IS NULL THEN
        RAISE NOTICE 'Skipping sample sales seed - prerequisite data not found.';
        RETURN;
    END IF;

    -- ── Sale 1: Walk-in, 7 days ago ──────────────────────────────
    -- Check if this seed sale already exists to prevent duplicate seeding
    IF NOT EXISTS (SELECT 1 FROM sales WHERE sale_number LIKE 'SEED-%') THEN

        INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount,
                           total_amount, payment_method, payment_status, amount_paid, change_due, transaction_date)
        VALUES ('SEED-001', v_walkin_id, v_cashier_id, 90.00, 14.40, 0, 104.40,
                'Cash', 'Paid', 110.00, 5.60, NOW() - INTERVAL '7 days')
        RETURNING sale_id INTO v_sale_id;

        INSERT INTO sale_items (sale_id, item_type, product_id, description, quantity, unit_price, discount, line_total)
        VALUES
            (v_sale_id, 'product', v_paper_id,   'A4 Paper Ream (500 sheets)', 2, 45.00, 0, 90.00);

        -- Deduct stock
        UPDATE products SET stock_quantity = stock_quantity - 2 WHERE product_id = v_paper_id;

        -- Inventory movement ledger
        SELECT stock_quantity INTO v_balance FROM products WHERE product_id = v_paper_id;
        INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after, reason, performed_by, reference_type, reference_id)
        VALUES (v_paper_id, 'SALE', 2, v_balance, 'Sale SEED-001', v_cashier_id, 'sale', v_sale_id);

        -- ── Sale 2: John Mwale, 5 days ago ──────────────────────
        INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount,
                           total_amount, payment_method, payment_status, amount_paid, change_due, transaction_date)
        VALUES ('SEED-002', v_john_id, v_cashier_id, 218.00, 34.88, 0, 252.88,
                'Mobile Money', 'Paid', 252.88, 0, NOW() - INTERVAL '5 days')
        RETURNING sale_id INTO v_sale_id;

        INSERT INTO sale_items (sale_id, item_type, product_id, description, quantity, unit_price, discount, line_total)
        VALUES
            (v_sale_id, 'product', v_pen_blue_id, 'Ballpoint Pen (Blue)',   10,  3.00, 0,  30.00),
            (v_sale_id, 'product', v_usb16_id,    'USB Flash Drive 16GB',    2, 50.00, 0, 100.00),
            (v_sale_id, 'product', v_pencil_id,   'HB Pencil',              10,  2.00, 0,  20.00),
            (v_sale_id, 'product', v_stapler_id,  'Stapler',                 1, 25.00, 0,  25.00),
            (v_sale_id, 'service', NULL,           'Photocopy B&W (A4)',    43,  1.00, 0,  43.00);

        UPDATE products SET stock_quantity = stock_quantity - 10 WHERE product_id = v_pen_blue_id;
        UPDATE products SET stock_quantity = stock_quantity - 2  WHERE product_id = v_usb16_id;
        UPDATE products SET stock_quantity = stock_quantity - 10 WHERE product_id = v_pencil_id;
        UPDATE products SET stock_quantity = stock_quantity - 1  WHERE product_id = v_stapler_id;

        SELECT stock_quantity INTO v_balance FROM products WHERE product_id = v_pen_blue_id;
        INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after, reason, performed_by, reference_type, reference_id)
        VALUES (v_pen_blue_id, 'SALE', 10, v_balance, 'Sale SEED-002', v_cashier_id, 'sale', v_sale_id);

        SELECT stock_quantity INTO v_balance FROM products WHERE product_id = v_usb16_id;
        INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after, reason, performed_by, reference_type, reference_id)
        VALUES (v_usb16_id, 'SALE', 2, v_balance, 'Sale SEED-002', v_cashier_id, 'sale', v_sale_id);

        -- ── Sale 3: Walk-in, Graphics service, 3 days ago ────────
        INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount,
                           total_amount, payment_method, payment_status, amount_paid, change_due, transaction_date)
        VALUES ('SEED-003', v_walkin_id, v_director_id, 150.00, 24.00, 0, 174.00,
                'Cash', 'Paid', 200.00, 26.00, NOW() - INTERVAL '3 days')
        RETURNING sale_id INTO v_sale_id;

        INSERT INTO sale_items (sale_id, item_type, service_id, description, quantity, unit_price, discount, line_total)
        VALUES
            (v_sale_id, 'service', v_poster_svc_id, 'Poster Design', 1, 150.00, 0, 150.00);

        -- ── Sale 4: Walk-in, Toner + A4, 1 day ago ───────────────
        INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount,
                           total_amount, payment_method, payment_status, amount_paid, change_due, transaction_date)
        VALUES ('SEED-004', v_walkin_id, v_cashier_id, 395.00, 63.20, 0, 458.20,
                'Cash', 'Paid', 460.00, 1.80, NOW() - INTERVAL '1 day')
        RETURNING sale_id INTO v_sale_id;

        INSERT INTO sale_items (sale_id, item_type, product_id, description, quantity, unit_price, discount, line_total)
        VALUES
            (v_sale_id, 'product', v_toner_b_id, 'Toner Cartridge (Black)',  1, 350.00, 0, 350.00),
            (v_sale_id, 'product', v_paper_id,   'A4 Paper Ream (500 sheets)', 1, 45.00, 0,  45.00);

        UPDATE products SET stock_quantity = stock_quantity - 1 WHERE product_id = v_toner_b_id;
        UPDATE products SET stock_quantity = stock_quantity - 1 WHERE product_id = v_paper_id;

        SELECT stock_quantity INTO v_balance FROM products WHERE product_id = v_toner_b_id;
        INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after, reason, performed_by, reference_type, reference_id)
        VALUES (v_toner_b_id, 'SALE', 1, v_balance, 'Sale SEED-004', v_cashier_id, 'sale', v_sale_id);

        SELECT stock_quantity INTO v_balance FROM products WHERE product_id = v_paper_id;
        INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after, reason, performed_by, reference_type, reference_id)
        VALUES (v_paper_id, 'SALE', 1, v_balance, 'Sale SEED-004', v_cashier_id, 'sale', v_sale_id);

        -- ── Sale 5: Today ─────────────────────────────────────────
        INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount,
                           total_amount, payment_method, payment_status, amount_paid, change_due, transaction_date)
        VALUES ('SEED-005', v_walkin_id, v_cashier_id, 43.00, 6.88, 0, 49.88,
                'Cash', 'Paid', 50.00, 0.12, NOW())
        RETURNING sale_id INTO v_sale_id;

        INSERT INTO sale_items (sale_id, item_type, service_id, description, quantity, unit_price, discount, line_total)
        VALUES
            (v_sale_id, 'service', v_photocopy_id, 'Photocopy B&W (A4)', 43, 1.00, 0, 43.00);

        RAISE NOTICE 'Sample sales data seeded successfully (SEED-001 to SEED-005).';
    ELSE
        RAISE NOTICE 'Sample sales already seeded — skipping.';
    END IF;
END $$;
