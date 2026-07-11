const pool = require('../db/pool');
const { sendEmail } = require('../utils/email');

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
    const v = Number(n || 0);
    return 'K ' + v.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * GET /api/quotes
 * List quotes with filters
 */
async function listQuotes(req, res) {
    try {
        const { status, search } = req.query;
        let query = `
            SELECT q.*, c.full_name as customer_name 
            FROM quotes q
            LEFT JOIN customers c ON q.customer_id = c.customer_id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND q.status = $${params.length}`;
        }

        if (search) {
            params.push(`%${search}%`);
            query += ` AND (q.quote_number ILIKE $${params.length} OR c.full_name ILIKE $${params.length})`;
        }

        query += ` ORDER BY q.created_at DESC LIMIT 50`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('List quotes error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/quotes/:id
 * Get single quote details with items
 */
async function getQuote(req, res) {
    try {
        const { id } = req.params;
        // JOIN users so the redesigned quote print can show
        // "Prepared by: <staff full name>" without a second roundtrip.
        const quote = await pool.query(`
            SELECT q.*,
                   c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
                   c.company_name AS customer_company,
                   u.full_name AS staff_name, u.username AS staff_username
            FROM quotes q
            LEFT JOIN customers c ON q.customer_id = c.customer_id
            LEFT JOIN users     u ON q.created_by  = u.user_id
            WHERE q.quote_id = $1
        `, [id]);

        if (quote.rows.length === 0) return res.status(404).json({ error: 'Quote not found' });

        const items = await pool.query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY item_id', [id]);

        res.json({ ...quote.rows[0], items: items.rows });
    } catch (err) {
        console.error('Get quote error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/quotes
 * Create a new quote
 */
/**
 * Resolve the configured VAT rate (single source of truth used by both
 * createQuote + updateQuote). Returns 0 when the caller opted out via
 * `apply_tax: false` so v1.0.7+ quotes can be VAT-exempt.
 */
async function resolveTaxRate(client, applyTax) {
    if (applyTax === false) return 0;
    const r = await client.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'tax.rate'"
    );
    return r.rows.length > 0 ? parseFloat(r.rows[0].setting_value) : 0.16;
}

/**
 * Derive the row's item_type from what's actually present, so the
 * sale_items.chk_item_type CHECK constraint is always satisfied:
 *   product → product_id NOT NULL
 *   service → service_id NOT NULL
 *   custom  → neither id present (free-text line)
 * Trusting the client-supplied `type` field led to bug #v1.0.10b where
 * a stale hidden `[name="item_type"]` input on a custom line still said
 * "product" with product_id=NULL, which then exploded on convertToSale.
 */
function normalizeItemType(item) {
    if (item.product_id) return 'product';
    if (item.service_id) return 'service';
    return 'custom';
}

/**
 * Reject items that mix product_id + service_id on the same line. Such a
 * row is unambiguously corrupt: normalizeItemType would silently pick
 * 'product' and convertToSale would then decrement stock — but the line
 * also carries a service_id, so the customer's intent is undefined. Better
 * to refuse the write than guess. Returns null when the item is OK or a
 * human-readable error string otherwise.
 */
function validateQuoteItem(item, idx) {
    if (item.product_id && item.service_id) {
        return `Item #${idx + 1} has both a product and a service attached — pick one.`;
    }
    return null;
}

/**
 * Compute subtotal/tax/discount/total from an items array. Items already have
 * been validated and the per-row line_total is recomputed here so the client
 * cannot lie about totals.
 */
function computeQuoteTotals(items, taxRate) {
    let subtotal = 0;
    let discountTotal = 0;
    const enriched = items.map((item) => {
        const qty = parseFloat(item.quantity) || 1;
        const price = parseFloat(item.unit_price) || 0;
        const discount = parseFloat(item.discount) || 0;
        const lineTotal = (price * qty) - discount;
        subtotal += lineTotal;
        discountTotal += discount;
        const type = normalizeItemType(item);
        return { ...item, type, qty, price, discount, lineTotal };
    });
    const taxTotal = subtotal * taxRate;
    const totalAmount = subtotal + taxTotal;
    return { subtotal, taxTotal, discountTotal, totalAmount, enriched };
}

async function createQuote(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { customer_id, items, notes, valid_until, apply_tax } = req.body;
        // items: [{ type, product_id, service_id, description, quantity, unit_price, discount }]

        if (!Array.isArray(items) || items.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'A quote must contain at least one item.' });
        }

        for (let i = 0; i < items.length; i++) {
            const err = validateQuoteItem(items[i], i);
            if (err) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: err });
            }
        }

        // Generate Quote Number
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countRes = await client.query("SELECT COUNT(*) FROM quotes WHERE created_at::date = CURRENT_DATE");
        const count = parseInt(countRes.rows[0].count) + 1;
        const quoteNumber = `QTE-${dateStr}-${String(count).padStart(3, '0')}`;

        // Tax rate fetched ONCE (was N+1 inside the items loop pre-1.0.7).
        const taxRate = await resolveTaxRate(client, apply_tax);
        const totals = computeQuoteTotals(items, taxRate);

        // v1.0.15 — refuse zero-value quotes. A quote with subtotal <= 0
        // is almost always a data-entry mistake (price field left blank,
        // qty zeroed out) and printing one would damage the customer's
        // trust in the paperwork. Validate after totals are computed so
        // discounts that bring an otherwise positive cart to zero are
        // also rejected.
        if (!(totals.subtotal > 0)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Quote subtotal must be greater than zero. Set a non-zero unit price on at least one line.'
            });
        }

        // Create Quote Header
        const quoteRes = await client.query(`
            INSERT INTO quotes (quote_number, customer_id, notes, valid_until, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING quote_id
        `, [quoteNumber, customer_id, notes, valid_until, req.user.user_id]);

        const quoteId = quoteRes.rows[0].quote_id;

        for (const item of totals.enriched) {
            await client.query(`
                INSERT INTO quote_items (quote_id, item_type, product_id, service_id, description, quantity, unit_price, discount, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                quoteId,
                item.type,
                item.product_id || null,
                item.service_id || null,
                item.description,
                item.qty,
                item.price,
                item.discount,
                item.lineTotal,
            ]);
        }

        await client.query(`
            UPDATE quotes
            SET subtotal = $1, tax_amount = $2, discount_amount = $3, total_amount = $4
            WHERE quote_id = $5
        `, [totals.subtotal, totals.taxTotal, totals.discountTotal, totals.totalAmount, quoteId]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Quote created', quote_id: quoteId, quote_number: quoteNumber });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create quote error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}

/**
 * PUT /api/quotes/:id
 * Edit a quote's customer/items/notes/valid_until/apply_tax.
 * Allowed only while the quote is still Draft or Sent — Accepted, Declined,
 * Converted and Expired quotes are frozen because changing them after a
 * customer has seen them would silently drift the printed copy.
 */
async function updateQuote(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { customer_id, items, notes, valid_until, apply_tax } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'A quote must contain at least one item.' });
        }

        for (let i = 0; i < items.length; i++) {
            const err = validateQuoteItem(items[i], i);
            if (err) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: err });
            }
        }

        const cur = await client.query(
            'SELECT status, converted_sale_id FROM quotes WHERE quote_id = $1 FOR UPDATE',
            [id]
        );
        if (cur.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Quote not found.' });
        }
        const status = cur.rows[0].status;
        if (cur.rows[0].converted_sale_id || !['Draft', 'Sent'].includes(status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `Cannot edit a quote in status "${status}". Only Draft and Sent quotes are editable.`,
            });
        }

        const taxRate = await resolveTaxRate(client, apply_tax);
        const totals = computeQuoteTotals(items, taxRate);

        // v1.0.15 — same zero-value guard as createQuote so an editor
        // cannot blank-out prices on an existing draft and save it.
        if (!(totals.subtotal > 0)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Quote subtotal must be greater than zero. Set a non-zero unit price on at least one line.'
            });
        }

        // Replace items in-place (simpler + correct than diffing).
        await client.query('DELETE FROM quote_items WHERE quote_id = $1', [id]);
        for (const item of totals.enriched) {
            await client.query(`
                INSERT INTO quote_items (quote_id, item_type, product_id, service_id, description, quantity, unit_price, discount, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                id,
                item.type,
                item.product_id || null,
                item.service_id || null,
                item.description,
                item.qty,
                item.price,
                item.discount,
                item.lineTotal,
            ]);
        }

        await client.query(`
            UPDATE quotes
            SET customer_id = $1,
                notes = $2,
                valid_until = $3,
                subtotal = $4,
                tax_amount = $5,
                discount_amount = $6,
                total_amount = $7,
                updated_at = NOW()
            WHERE quote_id = $8
        `, [
            customer_id,
            notes,
            valid_until,
            totals.subtotal,
            totals.taxTotal,
            totals.discountTotal,
            totals.totalAmount,
            id,
        ]);

        await client.query('COMMIT');
        res.json({ message: 'Quote updated', quote_id: id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Update quote error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}

/**
 * PATCH /api/quotes/:id/status
 * Update status
 */
const ALLOWED_QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'];

async function updateQuoteStatus(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !ALLOWED_QUOTE_STATUSES.includes(status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `Invalid status. Allowed values: ${ALLOWED_QUOTE_STATUSES.join(', ')}. Use POST /api/quotes/:id/convert to convert a quote into a sale.`
            });
        }
        const result = await client.query(
            'UPDATE quotes SET status = $1, updated_at = NOW() WHERE quote_id = $2 AND status <> $3 RETURNING status',
            [status, id, 'Converted']
        );
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Quote not found or already converted (cannot change status of a converted quote).' });
        }

        // On Accepted, auto-issue an invoice in the same transaction.
        // The partial UNIQUE on invoices.source_quote_id means flipping
        // the quote Sent → Accepted → Sent → Accepted only ever
        // produces ONE invoice row. Failures here roll the status
        // change back so the operator sees the problem instead of an
        // accepted quote with no paper trail.
        let invoice = null;
        if (status === 'Accepted') {
            const { createInvoiceFromQuote } = require('../services/invoiceFromSource');
            invoice = await createInvoiceFromQuote(client, id, {
                createdBy: req.user && req.user.user_id,
            });
        }

        await client.query('COMMIT');
        const payload = { message: `Quote status updated to ${status}` };
        if (invoice) {
            payload.invoice_id = invoice.invoice_id;
            payload.invoice_number = invoice.invoice_number;
        }
        res.json(payload);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('updateQuoteStatus error:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    } finally {
        client.release();
    }
}

/**
 * POST /api/quotes/:id/convert
 * Convert Quote to Sale
 */
async function convertToSale(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        // 1. Get Quote — FOR UPDATE so a concurrent updateQuote (which also
        //    locks the row) and a parallel convertToSale cannot both pass
        //    the status check from stale reads. Without the lock, two
        //    cashiers double-clicking "Convert to Sale" within the same
        //    millisecond produced two sales rows + two stock decrements.
        const quoteRes = await client.query(
            'SELECT * FROM quotes WHERE quote_id = $1 FOR UPDATE',
            [id]
        );
        if (quoteRes.rows.length === 0) throw new Error('Quote not found');
        const quote = quoteRes.rows[0];

        // Re-check post-lock — another transaction may have just converted it.
        if (quote.status === 'Converted' || quote.converted_sale_id) {
            throw new Error('Quote already converted');
        }

        // 2. Get Items
        const itemsRes = await client.query('SELECT * FROM quote_items WHERE quote_id = $1', [id]);
        const items = itemsRes.rows;

        // 3. Create Sale Header
        // Generate Sale Number
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countRes = await client.query("SELECT COUNT(*) FROM sales WHERE transaction_date::date = CURRENT_DATE");
        const count = parseInt(countRes.rows[0].count) + 1;
        const saleNumber = `SALE-${dateStr}-${String(count).padStart(4, '0')}`;

        const saleRes = await client.query(`
            INSERT INTO sales (sale_number, customer_id, payment_method, subtotal, tax_amount, total_amount, amount_paid, change_due, payment_status, staff_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING sale_id
        `, [
            saleNumber,
            quote.customer_id,
            'Quote Conversion', // payment_method
            quote.subtotal,
            quote.tax_amount,
            quote.total_amount,
            0, // amount_paid
            0, // change_due
            'Pending', // payment_status
            req.user.user_id
        ]);
        const saleId = saleRes.rows[0].sale_id;

        // 4. Create Sale Items & Reduce Stock
        for (const item of items) {
            // Re-derive item_type from what's actually present so the
            // sale_items chk_item_type CHECK passes even when the source
            // quote_items row is corrupt (item_type='product' with NULL
            // product_id was the bug fixed in v1.0.10b). Also preserve
            // description — previously dropped, which truncated custom
            // line items to "(no description)" on the resulting receipt.
            const itemType = normalizeItemType(item);
            await client.query(`
                INSERT INTO sale_items (sale_id, item_type, product_id, service_id, description, quantity, unit_price, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [saleId, itemType, item.product_id, item.service_id, item.description, item.quantity, item.unit_price, item.line_total]);

            // Reduce Stock if Product
            if (item.product_id) {
                await client.query(`
                    UPDATE products SET stock_quantity = stock_quantity - $1 
                    WHERE product_id = $2
                `, [item.quantity, item.product_id]);

                // Log Movement
                await client.query(`
                    INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, reason, performed_by)
                    VALUES ($1, 'SALE', $2, 'sale', $3, 'Quote Conversion', $4)
                `, [item.product_id, -item.quantity, saleId, req.user.user_id]);
            }
        }

        // 5. Update Quote
        await client.query('UPDATE quotes SET status = $1, converted_sale_id = $2, updated_at = NOW() WHERE quote_id = $3', ['Converted', saleId, id]);

        // 6. Auto-invoice the resulting credit sale. payment_status is
        // 'Pending' (set above) so the sale qualifies as a credit row;
        // the partial UNIQUE on invoices.source_sale_id keeps this
        // idempotent across sync retries.
        let invoice = null;
        try {
            const { createInvoiceFromSale } = require('../services/invoiceFromSource');
            invoice = await createInvoiceFromSale(client, saleId, {
                createdBy: req.user && req.user.user_id,
            });
        } catch (invErr) {
            console.error('[convertToSale] auto-invoice failed (conversion still commits):', invErr.message);
        }

        await client.query('COMMIT');
        res.json({
            message: 'Quote converted to sale',
            sale_id: saleId,
            sale_number: saleNumber,
            invoice_id: invoice && invoice.invoice_id,
            invoice_number: invoice && invoice.invoice_number,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Convert quote error:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    } finally {
        client.release();
    }
}

/**
 * POST /api/quotes/:id/email
 * Email a quote to a recipient as an inline HTML quotation. The frontend
 * passes { email } and (optionally) { auto_mark_sent: true } to advance the
 * quote status in one round-trip after a successful send.
 */
async function emailQuote(req, res) {
    try {
        const { id } = req.params;
        const { email, auto_mark_sent } = req.body || {};
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
            return res.status(400).json({ error: 'A valid recipient email is required.' });
        }

        const qRes = await pool.query(`
            SELECT q.*,
                   c.full_name AS customer_name, c.email AS customer_email,
                   c.phone AS customer_phone, c.company_name AS customer_company,
                   u.full_name AS staff_name, u.username AS staff_username
            FROM quotes q
            LEFT JOIN customers c ON q.customer_id = c.customer_id
            LEFT JOIN users     u ON q.created_by  = u.user_id
            WHERE q.quote_id = $1
        `, [id]);
        if (qRes.rows.length === 0) return res.status(404).json({ error: 'Quote not found' });
        const quote = qRes.rows[0];

        const itemsRes = await pool.query(
            'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY item_id',
            [id]
        );
        const items = itemsRes.rows;

        // Pull store letterhead from system_settings so the email matches the print template.
        // NOTE: column names are setting_key/setting_value (mirror createQuote tax.rate lookup at line ~124).
        const sRes = await pool.query(
            "SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'store.%'"
        );
        const settings = {};
        for (const row of sRes.rows) settings[row.setting_key] = row.setting_value;
        const storeName = settings['store.name'] || 'Zachi Computer Centre';
        const storePhone = settings['store.phone'] || '';
        const storeEmail = settings['store.email'] || '';
        const storeAddr  = settings['store.address'] || '';
        const storeTpin  = settings['store.tpin'] || '';

        const validUntil = quote.valid_until
            ? new Date(quote.valid_until).toLocaleDateString('en-ZM')
            : null;
        const createdAt = new Date(quote.created_at || Date.now()).toLocaleString('en-ZM');

        const itemRows = items.map((it, i) => `
            <tr>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${i + 1}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(it.description)}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${Number(it.quantity)}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${fmtMoney(it.unit_price)}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${fmtMoney(it.line_total)}</td>
            </tr>
        `).join('');

        const html = `
            <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:680px;margin:auto;">
                <h2 style="margin:0 0 4px 0;color:#1B3A5C;">${escapeHtml(storeName)}</h2>
                <div style="font-size:12px;color:#666;">
                    ${escapeHtml(storeAddr)}${storeAddr ? ' &middot; ' : ''}
                    ${storePhone ? 'Tel: ' + escapeHtml(storePhone) : ''}
                    ${storePhone && storeEmail ? ' &middot; ' : ''}
                    ${storeEmail ? 'Email: ' + escapeHtml(storeEmail) : ''}
                    ${storeTpin ? '<br>TPIN: ' + escapeHtml(storeTpin) : ''}
                </div>
                <h3 style="border-bottom:2px solid #1B3A5C;padding-bottom:4px;margin-top:24px;">QUOTATION ${escapeHtml(quote.quote_number || '')}</h3>
                <table style="width:100%;font-size:13px;margin-bottom:12px;">
                    <tr>
                        <td><strong>Bill To:</strong> ${escapeHtml(quote.customer_name || 'Walk-in Customer')}
                            ${quote.customer_company ? '<br>' + escapeHtml(quote.customer_company) : ''}
                            ${quote.customer_phone   ? '<br>Tel: ' + escapeHtml(quote.customer_phone) : ''}
                        </td>
                        <td style="text-align:right;">
                            <strong>Date:</strong> ${escapeHtml(createdAt)}<br>
                            ${validUntil ? '<strong>Valid Until:</strong> ' + escapeHtml(validUntil) + '<br>' : ''}
                            <strong>Status:</strong> ${escapeHtml(quote.status)}
                        </td>
                    </tr>
                </table>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="background:#f5f5f5;">
                            <th style="padding:6px 8px;border:1px solid #ddd;width:30px;">#</th>
                            <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Description</th>
                            <th style="padding:6px 8px;border:1px solid #ddd;width:50px;">Qty</th>
                            <th style="padding:6px 8px;border:1px solid #ddd;width:90px;text-align:right;">Unit Price</th>
                            <th style="padding:6px 8px;border:1px solid #ddd;width:100px;text-align:right;">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                </table>
                <table style="width:100%;font-size:13px;margin-top:8px;">
                    <tr><td style="text-align:right;padding:2px 8px;">Subtotal:</td><td style="width:120px;text-align:right;">${fmtMoney(quote.subtotal)}</td></tr>
                    ${Number(quote.discount_amount) > 0 ? `<tr><td style="text-align:right;padding:2px 8px;">Discount:</td><td style="text-align:right;">- ${fmtMoney(quote.discount_amount)}</td></tr>` : ''}
                    <tr><td style="text-align:right;padding:2px 8px;">VAT:</td><td style="text-align:right;">${fmtMoney(quote.tax_amount)}</td></tr>
                    <tr style="font-weight:bold;background:#f5f5f5;"><td style="text-align:right;padding:6px 8px;">TOTAL:</td><td style="text-align:right;padding:6px 8px;">${fmtMoney(quote.total_amount)}</td></tr>
                </table>
                ${quote.notes ? `<p style="font-size:13px;margin-top:16px;"><strong>Notes:</strong> ${escapeHtml(quote.notes)}</p>` : ''}
                <p style="margin-top:24px;font-size:13px;color:#444;">
                    Thank you for considering ${escapeHtml(storeName)}.
                    ${validUntil ? 'This quotation is valid until <strong>' + escapeHtml(validUntil) + '</strong>.' : ''}
                </p>
                <p style="font-size:11px;color:#888;margin-top:32px;">
                    Prepared by ${escapeHtml(quote.staff_name || quote.staff_username || '—')}
                </p>
            </div>
        `;

        const subject = `Quotation ${quote.quote_number || ''} - ${storeName}`.trim();

        // Render + attach the branded PDF copy. On render failure fall
        // back to a signed download link so the customer always gets
        // something they can read.
        const { renderQuotePdf, renderToBuffer, buildSignedUrl } =
            require('../services/pdfService');
        let pdfBuffer = null;
        let renderErr = null;
        try {
            pdfBuffer = await renderToBuffer(renderQuotePdf, { ...quote, items });
        } catch (e) {
            renderErr = e;
            console.error('[emailQuote] PDF render failed; falling back to link:', e);
        }

        if (pdfBuffer) {
            await sendEmail(email, subject, html, [
                { filename: `Quote-${quote.quote_number || quote.quote_id}.pdf`, content: pdfBuffer },
            ]);
        } else {
            try {
                const link = buildSignedUrl(req, 'quote', quote.quote_id);
                const linkHtml = html +
                    `<p style="margin-top:18px;font-size:13px;">
                        PDF copy: <a href="${link.url}">${link.url}</a><br>
                        <small>Link expires ${new Date(link.exp * 1000).toUTCString()}.</small>
                     </p>`;
                await sendEmail(email, subject, linkHtml, []);
            } catch (linkErr) {
                console.error('[emailQuote] link fallback also failed:', linkErr);
                return res.status(500).json({
                    error: 'Failed to email quote: ' +
                        (renderErr && renderErr.message || 'unknown error'),
                });
            }
        }

        if (auto_mark_sent && quote.status !== 'Sent' && quote.status !== 'Accepted' && quote.status !== 'Converted') {
            await pool.query(
                'UPDATE quotes SET status = $1, updated_at = NOW() WHERE quote_id = $2',
                ['Sent', id]
            );
        }

        res.json({ message: 'Quote emailed', to: email, fallback: pdfBuffer ? null : 'link' });
    } catch (err) {
        console.error('Email quote error:', err);
        res.status(500).json({ error: err.message || 'Failed to send quote email' });
    }
}

module.exports = { listQuotes, getQuote, createQuote, updateQuote, updateQuoteStatus, convertToSale, emailQuote };
