-- =====================================================
-- Zachi Smart-POS - Seed Data
-- =====================================================
-- Default Director account (password: admin123)
-- bcrypt hash generated for 'admin123'
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES (
        'director',
        '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'Zachi Director',
        'director@zachi.co.zm',
        'director'
    ) ON CONFLICT (username) DO NOTHING;
-- Default Cashier account (password: cashier123)
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES (
        'cashier1',
        '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'Front Desk Cashier',
        'cashier@zachi.co.zm',
        'cashier'
    ) ON CONFLICT (username) DO NOTHING;
-- Default Designer account (password: designer123)
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES (
        'designer1',
        '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'Lead Graphic Designer',
        'designer@zachi.co.zm',
        'designer'
    ) ON CONFLICT (username) DO NOTHING;
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