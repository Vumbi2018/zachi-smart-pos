const pool = require('../db/pool');
const { calculatePrice } = require('../utils/pricing');
const { sendEmail } = require('../utils/email');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * POST /api/sales
 * Create a new sale with hybrid cart (products + services)
 */
async function createSale(req, res) {
    const client = await pool.connect();

    try {
        console.log('Starting sale transaction...');
        await client.query('BEGIN');
        console.log('Transaction started');

        const { customer_id, items, payment_method, amount_paid, notes, tax_exempt, discount_amount, points_redeemed, transaction_date } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required.' });
        }

        // Calculate totals
        let subtotal = 0;
        const processedItems = [];

        // Constants for Loyalty (could be moved to settings later)
        const POINTS_EARN_RATE = 0.1; // Earn 1 point per K10
        const POINTS_REDEEM_VALUE = 1.0; // 1 Point = K1.00

        for (const item of items) {
            let unitPrice = 0;
            let description = '';

            if (item.type === 'product') {
                const product = await client.query('SELECT * FROM products WHERE product_id = $1 AND is_active = TRUE', [item.product_id]);
                if (product.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `Product ID ${item.product_id} not found.` });
                }

                const p = product.rows[0];

                // Check stock
                if (p.stock_quantity < item.quantity) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `Insufficient stock for "${p.name}". Available: ${p.stock_quantity}` });
                }

                unitPrice = item.price_override || p.unit_price;
                description = p.name;

                // Deduct stock
                await client.query(
                    'UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
                    [item.quantity, item.product_id]
                );

            } else if (item.type === 'service') {
                const service = await client.query('SELECT * FROM services WHERE service_id = $1 AND is_active = TRUE', [item.service_id]);
                if (service.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `Service ID ${item.service_id} not found.` });
                }

                const s = service.rows[0];
                unitPrice = item.price_override || calculatePrice(s, item.quantity, item.options);
                description = s.service_name;

            } else {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Each item must have type "product" or "service".' });
            }

            // Line discount logic (if per-item discount is used)
            const itemDiscount = item.discount || 0;
            const lineTotal = (unitPrice * item.quantity) - itemDiscount;

            processedItems.push({
                item_type: item.type,
                product_id: item.product_id || null,
                service_id: item.service_id || null,
                description: item.description || description,
                name: description,
                quantity: item.quantity,
                unit_price: unitPrice,
                discount: itemDiscount,
                line_total: lineTotal
            });

            subtotal += lineTotal;
        }

        // --- Discount & Loyalty Logic ---
        const manualDiscount = parseFloat(discount_amount) || 0;
        let loyaltyDiscount = 0;
        let pointsRedeemed = parseInt(points_redeemed) || 0;

        if (pointsRedeemed > 0) {
            if (!customer_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Customer is required to redeem points.' });
            }

            // Check customer points balance
            const custRes = await client.query('SELECT loyalty_points FROM customers WHERE customer_id = $1', [customer_id]);
            if (custRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Customer not found.' });
            }

            const currentPoints = custRes.rows[0].loyalty_points;
            if (currentPoints < pointsRedeemed) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Insufficient loyalty points. Balance: ${currentPoints}` });
            }

            loyaltyDiscount = pointsRedeemed * POINTS_REDEEM_VALUE;

            // DBS: Deduct points
            await client.query('UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE customer_id = $2', [pointsRedeemed, customer_id]);

            // Log Redemption
            await client.query(
                'INSERT INTO loyalty_transactions (customer_id, transaction_type, points, reference_type, balance_after, notes) VALUES ($1, $2, $3, $4, $5, $6)',
                [customer_id, 'redeem', pointsRedeemed, 'sale', (currentPoints - pointsRedeemed), 'Redeemed on sale']
            );
        }

        const totalDiscount = manualDiscount + loyaltyDiscount;
        const taxableAmount = Math.max(0, subtotal - totalDiscount);

        // --- Tax Logic ---
        const taxRate = tax_exempt ? 0 : 0.16;
        const taxAmount = parseFloat((taxableAmount * taxRate).toFixed(2));
        const totalAmount = parseFloat((taxableAmount + taxAmount).toFixed(2));

        const paidAmount = amount_paid || totalAmount;
        const changeDue = Math.max(0, parseFloat((paidAmount - totalAmount).toFixed(2)));
        const paymentStatus = paidAmount >= totalAmount ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Credit');

        // Generate sale number: ZC-YYYYMMDD-NNN (use local date, not UTC)
        const localNow = new Date();
        const localDateStr = localNow.getFullYear().toString()
            + String(localNow.getMonth() + 1).padStart(2, '0')
            + String(localNow.getDate()).padStart(2, '0');
        const prefix = `ZC-${localDateStr}`;

        const lastSaleResult = await client.query(
            "SELECT sale_number FROM sales WHERE sale_number LIKE $1 ORDER BY sale_number DESC LIMIT 1",
            [`${prefix}-%`]
        );

        let nextSeq = 1;
        if (lastSaleResult.rows.length > 0) {
            const lastNumber = lastSaleResult.rows[0].sale_number;
            const parts = lastNumber.split('-');
            if (parts.length === 3) {
                nextSeq = parseInt(parts[2], 10) + 1;
            }
        }

        const saleSeq = nextSeq.toString().padStart(3, '0');
        const saleNumber = `${prefix}-${saleSeq}`;

        // Insert sale header
        const saleResult = await client.query(
            `INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount, total_amount, payment_method, payment_status, amount_paid, change_due, notes, payment_reference, transaction_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, CURRENT_TIMESTAMP))
       RETURNING *`,
            [saleNumber, customer_id || null, req.user.user_id, subtotal, taxAmount, totalDiscount, totalAmount,
                payment_method, paymentStatus, paidAmount, changeDue, notes || null, req.body.payment_reference || null, transaction_date]
        );

        const sale = saleResult.rows[0];

        // Insert line items
        for (const item of processedItems) {
            await client.query(
                `INSERT INTO sale_items (sale_id, item_type, product_id, service_id, description, quantity, unit_price, discount, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [sale.sale_id, item.item_type, item.product_id, item.service_id, item.description,
                item.quantity, item.unit_price, item.discount, item.line_total]
            );
        }

        // --- Loyalty Earning Logic ---
        if (customer_id && totalAmount > 0) {
            // Check if customer has a tier multiplier
            let multiplier = 1.0;
            // Fetch points again to be safe? Or just use previous. 
            // Better to join tiers, but simple lookup is fine.
            const custTier = await client.query(`
                SELECT t.points_multiplier 
                FROM customers c
                JOIN loyalty_tiers t ON c.loyalty_points >= t.min_points
                WHERE c.customer_id = $1
                ORDER BY t.min_points DESC LIMIT 1
            `, [customer_id]);

            if (custTier.rows.length > 0) {
                multiplier = parseFloat(custTier.rows[0].points_multiplier) || 1.0;
            }

            const pointsEarned = Math.floor(subtotal * POINTS_EARN_RATE * multiplier); // Earn on Subtotal or Total? Subtotal usually.

            if (pointsEarned > 0) {
                await client.query('UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE customer_id = $2', [pointsEarned, customer_id]);

                await client.query(
                    'INSERT INTO loyalty_transactions (customer_id, transaction_type, points, reference_type, reference_id, notes) VALUES ($1, $2, $3, $4, $5, $6)',
                    [customer_id, 'earn', pointsEarned, 'sale', sale.sale_id, `Earned from Sale ${saleNumber}`]
                );
            }
        }

        console.log('Committing transaction...');
        await client.query('COMMIT');
        console.log('Transaction committed successfully');

        // Return full sale with items
        sale.items = processedItems;
        res.status(201).json(sale);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create sale error:', err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    } finally {
        console.log('Releasing client');
        client.release();
    }
}

/**
 * GET /api/sales
 * List sales with filters (Director only)
 */
async function listSales(req, res) {
    try {
        const { date_from, date_to, payment_method, status, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        const conditions = [];

        if (date_from) {
            params.push(date_from);
            conditions.push(`transaction_date >= $${params.length}`);
        }

        if (date_to) {
            params.push(date_to + ' 23:59:59');
            conditions.push(`transaction_date <= $${params.length}`);
        }

        if (payment_method) {
            params.push(payment_method);
            conditions.push(`payment_method = $${params.length}`);
        }

        if (status) {
            params.push(status);
            conditions.push(`payment_status = $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(`SELECT COUNT(*) FROM sales ${where}`, params);
        const total = parseInt(countResult.rows[0].count, 10);

        params.push(limit);
        params.push(offset);
        const result = await pool.query(
            `SELECT s.*, u.full_name AS staff_name, c.full_name AS customer_name
       FROM sales s
       LEFT JOIN users u ON s.staff_id = u.user_id
       LEFT JOIN customers c ON s.customer_id = c.customer_id
       ${where}
       ORDER BY s.transaction_date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            sales: result.rows,
            pagination: { page: parseInt(page), limit: parseInt(limit), total }
        });
    } catch (err) {
        console.error('List sales error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/sales/:id
 * Get single sale with all line items
 */
async function getSale(req, res) {
    try {
        const sale = await pool.query(
            `SELECT s.*, u.full_name AS staff_name, c.full_name AS customer_name
       FROM sales s
       LEFT JOIN users u ON s.staff_id = u.user_id
       LEFT JOIN customers c ON s.customer_id = c.customer_id
       WHERE s.sale_id = $1`,
            [req.params.id]
        );

        if (sale.rows.length === 0) {
            return res.status(404).json({ error: 'Sale not found.' });
        }

        const items = await pool.query(
            `SELECT si.*, p.name AS product_name, sv.service_name
       FROM sale_items si
       LEFT JOIN products p ON si.product_id = p.product_id
       LEFT JOIN services sv ON si.service_id = sv.service_id
       WHERE si.sale_id = $1`,
            [req.params.id]
        );

        res.json({ ...sale.rows[0], items: items.rows });
    } catch (err) {
        console.error('Get sale error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * PATCH /api/sales/:id/void
 * Void a sale (Director only)
 */
async function voidSale(req, res) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const sale = await client.query('SELECT * FROM sales WHERE sale_id = $1', [req.params.id]);
        if (sale.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Sale not found.' });
        }

        if (sale.rows[0].is_voided) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Sale is already voided.' });
        }

        // Restore stock for product items
        const items = await client.query(
            "SELECT * FROM sale_items WHERE sale_id = $1 AND item_type = 'product'",
            [req.params.id]
        );

        for (const item of items.rows) {
            await client.query(
                'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2',
                [item.quantity, item.product_id]
            );
        }

        // Mark sale as voided
        const result = await client.query(
            `UPDATE sales SET is_voided = TRUE, voided_by = $1, voided_at = CURRENT_TIMESTAMP
       WHERE sale_id = $2 RETURNING *`,
            [req.user.user_id, req.params.id]
        );

        await client.query('COMMIT');
        res.json({ message: 'Sale voided successfully.', sale: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Void sale error:', err);
        res.status(500).json({ error: 'Server error.' });
    } finally {
        client.release();
    }
}

/**
 * POST /api/sales/receipt/email
 * Email a receipt to a customer
 */
async function emailReceipt(req, res) {
    try {
        const { sale_id, email } = req.body;

        if (!sale_id || !email) {
            return res.status(400).json({ error: 'Sale ID and email are required.' });
        }

        // Fetch sale details
        const saleResult = await pool.query(
            `SELECT s.*, u.full_name AS staff_name
             FROM sales s
             LEFT JOIN users u ON s.staff_id = u.user_id
             WHERE s.sale_id = $1`,
            [sale_id]
        );

        if (saleResult.rows.length === 0) {
            return res.status(404).json({ error: 'Sale not found.' });
        }

        const sale = saleResult.rows[0];

        // Fetch items
        const itemsResult = await pool.query(
            `SELECT si.*, p.name AS product_name, sv.service_name
             FROM sale_items si
             LEFT JOIN products p ON si.product_id = p.product_id
             LEFT JOIN services sv ON si.service_id = sv.service_id
             WHERE si.sale_id = $1`,
            [sale_id]
        );

        const items = itemsResult.rows;

        // Generate HTML Receipt
        const logoPath = path.join(__dirname, '..', 'public', 'logo.jpg');
        const logoBase64 = fs.readFileSync(logoPath).toString('base64');
        const logoSrc = `data:image/jpeg;base64,${logoBase64}`;

        const itemsHtml = items.map(item => `
            <div style="display:flex;justify-content:space-between;border-bottom:1px dashed #ddd;padding:5px 0;">
                <span>${item.quantity} x ${item.product_name || item.service_name || item.description}</span>
                <span>K ${(parseFloat(item.line_total) || 0).toFixed(2)}</span>
            </div>
        `).join('');

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: 'Courier New', monospace; padding: 20px; color: #000; }
                    .container { max-width: 400px; margin: 0 auto; border: 1px solid #eee; padding: 20px; }
                    .text-center { text-align: center; }
                    .bold { font-weight: bold; }
                    .flex { display: flex; justify-content: space-between; }
                    .border-bottom { border-bottom: 1px dashed #ccc; }
                    .my-2 { margin: 10px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="text-center">
                        <img src="${logoSrc}" alt="Zachi Logo" style="max-height: 80px; margin-bottom: 5px;">
                        <h2 style="margin:5px 0;">Zachi Smart-POS</h2>
                        <p style="margin:0; font-size: 0.9em;">Near Coppers Corner, Independence Avenue, Solwezi</p>
                        <p style="margin:0; font-size: 0.9em;">+260 974 210 067</p>
                        <p style="margin:0; font-size: 0.9em;">zachicomputercentre120@gmail.com | info@zachicomputercentre.com</p>
                        <div class="bold my-2" style="margin-top: 15px;">OFFICIAL RECEIPT</div>
                    </div>
                    
                    <p>Date: ${new Date(sale.transaction_date).toLocaleString()}</p>
                    <p>Sale #: ${sale.sale_number}</p>
                    <hr class="border-bottom" style="border:0; border-top:1px dashed #ccc;">
                    
                    ${itemsHtml}
                    
                    <hr class="border-bottom" style="border:0; border-top:1px dashed #ccc;">
                    <div class="flex bold" style="margin-top:10px;">
                        <span>TOTAL</span>
                        <span>K ${parseFloat(sale.total_amount).toFixed(2)}</span>
                    </div>
                    <div class="flex">
                        <span>Paid (${sale.payment_method})</span>
                        <span>K ${parseFloat(sale.amount_paid).toFixed(2)}</span>
                    </div>
                    
                    <br>
                    <p class="text-center">Thank you for your business!</p>
                </div>
            </body>
            </html>
        `;

        // Generate PDF
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        // Send Email with PDF
        await sendEmail(
            email,
            `Receipt ${sale.sale_number} - Zachi POS`,
            `<p>Please find attached your receipt for sale <strong>${sale.sale_number}</strong>.</p>`,
            [
                {
                    filename: `Receipt-${sale.sale_number}.pdf`,
                    content: pdfBuffer
                }
            ]
        );

        res.json({ message: 'Receipt sent successfully.' });
    } catch (err) {
        console.error('Email receipt error:', err);
        res.status(500).json({ error: 'Failed to send email.' });
    }
}

module.exports = { createSale, listSales, getSale, voidSale, emailReceipt };
