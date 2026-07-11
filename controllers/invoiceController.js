/**
 * invoiceController.js
 *
 * CRUD + email + PDF for invoices. An invoice is created either:
 *   - automatically by salesController.createSale when a sale is
 *     credit/partial (see services/invoiceFromSource.js), or
 *   - automatically by quoteController.updateQuoteStatus when a
 *     quote is moved to 'Accepted', or
 *   - manually via POST /api/invoices (rare — matches the manual
 *     invoice path the Director uses for back-office adjustments).
 *
 * ACCESS:
 *   - List/get/update/markPaid/email require auth (role-restricted in
 *     routes/invoices.js).
 *   - PDF (`getInvoicePdf`) accepts an alternative signed-URL mode so
 *     a customer can download from a WhatsApp link without logging in.
 */
'use strict';

const pool = require('../db/pool');
const { sendEmail } = require('../utils/email');
const { getSetting } = require('../utils/settingsCache');
const {
    renderInvoicePdf,
    renderToBuffer,
    verifyToken,
    buildSignedUrl,
} = require('../services/pdfService');
const { mintInvoiceNumber } = require('../services/invoiceFromSource');
const PDFDocument = require('pdfkit');

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

async function _fetchInvoice(invoiceId) {
    const head = await pool.query(
        `SELECT i.*, u.full_name AS staff_name, u.username AS staff_username
         FROM invoices i
         LEFT JOIN users u ON u.user_id = i.created_by
         WHERE i.invoice_id = $1`,
        [invoiceId]
    );
    if (head.rows.length === 0) return null;
    const items = await pool.query(
        `SELECT * FROM invoice_items
         WHERE invoice_id = $1
         ORDER BY sort_order, created_at`,
        [invoiceId]
    );
    return { ...head.rows[0], items: items.rows };
}

// ── List ─────────────────────────────────────────────────────────
// GET /api/invoices?status=&search=
async function listInvoices(req, res) {
    try {
        const { status, search } = req.query;
        const params = [];
        let q = `SELECT i.*, u.full_name AS staff_name
                 FROM invoices i
                 LEFT JOIN users u ON u.user_id = i.created_by
                 WHERE 1=1`;
        if (status) {
            params.push(status);
            q += ` AND i.status = $${params.length}`;
        }
        if (search) {
            params.push(`%${search}%`);
            q += ` AND (i.invoice_number ILIKE $${params.length}
                   OR  i.customer_name   ILIKE $${params.length})`;
        }
        q += ` ORDER BY i.created_at DESC LIMIT 100`;
        const r = await pool.query(q, params);
        res.json(r.rows);
    } catch (err) {
        console.error('[invoices] list failed:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

// GET /api/invoices/:id
async function getInvoice(req, res) {
    try {
        const inv = await _fetchInvoice(req.params.id);
        if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
        res.json(inv);
    } catch (err) {
        console.error('[invoices] get failed:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

// PUT /api/invoices/:id — only Draft invoices may be edited.
async function updateInvoice(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const cur = await client.query(
            'SELECT status FROM invoices WHERE invoice_id = $1 FOR UPDATE',
            [id]
        );
        if (cur.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Invoice not found.' });
        }
        if (cur.rows[0].status !== 'Draft') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Only Draft invoices can be edited. Issue or void this one and create a new draft.',
            });
        }

        const { customer_name, customer_phone, customer_email, customer_company,
                due_date, notes, items } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'At least one item is required.' });
        }

        // Recompute totals from the supplied items so the client cannot
        // forge a mismatched total. Tax rate from system_settings.
        // VAT is optional per-invoice (Zambian invoicing rule — some
        // customers / line items are tax-exempt). Client sends
        // `apply_tax: false` on the create/update payload to zero the
        // tax line; default true preserves legacy behaviour.
        const applyTax = req.body && req.body.apply_tax === false ? false : true;
        const taxRateRow = await client.query(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'tax.rate'"
        );
        const taxRate = !applyTax
            ? 0
            : (taxRateRow.rows.length > 0
                ? parseFloat(taxRateRow.rows[0].setting_value) : 0.16);

        let subtotal = 0;
        const cleanItems = items.map((it, idx) => {
            const qty = Number(it.quantity) || 0;
            const unit = Number(it.unit_price) || 0;
            const disc = Number(it.discount) || 0;
            const line = +(qty * unit - disc).toFixed(2);
            subtotal += line;
            return {
                item_type: it.item_type || 'custom',
                product_id: it.product_id || null,
                service_id: it.service_id || null,
                description: String(it.description || 'Item'),
                quantity: qty,
                unit_price: unit,
                discount: disc,
                line_total: line,
                sort_order: idx,
            };
        });
        const discountAmount = Number(req.body.discount_amount) || 0;
        const taxable = Math.max(0, subtotal - discountAmount);
        const taxAmount = +(taxable * taxRate).toFixed(2);
        const total = +(taxable + taxAmount).toFixed(2);

        await client.query(
            `UPDATE invoices SET
                customer_name = $1, customer_phone = $2, customer_email = $3,
                customer_company = $4, due_date = $5, notes = $6,
                subtotal = $7, discount_amount = $8, tax_amount = $9, total_amount = $10,
                updated_at = NOW()
             WHERE invoice_id = $11`,
            [customer_name || null, customer_phone || null, customer_email || null,
             customer_company || null, due_date || null, notes || null,
             subtotal, discountAmount, taxAmount, total, id]
        );

        await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
        for (const it of cleanItems) {
            await client.query(
                `INSERT INTO invoice_items (
                    invoice_id, item_type, product_id, service_id,
                    description, quantity, unit_price, discount, line_total, sort_order
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [id, it.item_type, it.product_id, it.service_id,
                 it.description, it.quantity, it.unit_price, it.discount,
                 it.line_total, it.sort_order]
            );
        }

        await client.query('COMMIT');
        const fresh = await _fetchInvoice(id);
        res.json(fresh);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[invoices] update failed:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    } finally {
        client.release();
    }
}

// PATCH /api/invoices/:id/status — Issue / Void
async function updateInvoiceStatus(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body || {};
        const allowed = ['Draft', 'Issued', 'Void'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ error: 'Invalid status.', allowed });
        }
        const r = await pool.query(
            `UPDATE invoices
             SET status = $1, updated_at = NOW()
             WHERE invoice_id = $2
             RETURNING *`,
            [status, id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Invoice not found.' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[invoices] status failed:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

// POST /api/invoices/:id/payment — record a payment, advance status if cleared.
async function recordPayment(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const amt = Number(req.body && req.body.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'amount must be a positive number.' });
        }

        const inv = await client.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
            [id]
        );
        if (inv.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Invoice not found.' });
        }
        const cur = inv.rows[0];
        if (cur.status === 'Void') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Cannot pay a voided invoice.' });
        }

        const newPaid = Number(cur.amount_paid) + amt;
        const total = Number(cur.total_amount);
        const newStatus = newPaid >= total - 0.0001 ? 'Paid' : (cur.status === 'Draft' ? 'Issued' : cur.status);

        const r = await client.query(
            `UPDATE invoices
             SET amount_paid = $1, status = $2, updated_at = NOW()
             WHERE invoice_id = $3
             RETURNING *`,
            [newPaid, newStatus, id]
        );

        await client.query('COMMIT');
        res.json(r.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[invoices] payment failed:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    } finally {
        client.release();
    }
}

// POST /api/invoices — create a one-off / manual invoice.
//
// The migration 020 schema bump permits source_kind = 'manual' with
// both source_*_id columns NULL (the source_xor CHECK has a third arm
// for the manual case). This handler:
//
//   1. Validates the items array (≥1 line, each line has a description).
//   2. Resolves customer fields — a `customer_id` (UUID) hydrates
//      name/phone/email/company from the customers table. If no id is
//      supplied we accept free-text customer_name etc. straight from the
//      payload, which is the retainer/expense-reimbursement use case the
//      task explicitly calls out.
//   3. Recomputes subtotal + VAT server-side from the supplied items so
//      the client cannot forge a mismatched total. Tax rate read once
//      from system_settings inside the transaction.
//   4. Mints an INV-YYYYMMDD-NNNN number via the SAME advisory-lock
//      helper the auto-issue paths use (mintInvoiceNumber from
//      invoiceFromSource.js). One source of truth for the format.
//   5. Inserts the invoice header as 'Draft' so the user can keep
//      editing through the Edit-while-Draft modal before issuing —
//      mirrors how an auto-issued invoice that lands as 'Issued' moves
//      to 'Paid' through recordPayment.
//   6. Inserts the invoice_items in a positional sort_order.
//
// Whole thing runs in a single transaction; any failure ROLLBACKs so a
// half-written invoice can never appear in the listing.
async function createInvoice(req, res) {
    const items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'At least one item is required.' });
    }
    for (let i = 0; i < items.length; i++) {
        const desc = items[i] && String(items[i].description || '').trim();
        if (!desc) {
            return res.status(400).json({
                error: `Item #${i + 1} is missing a description.`,
            });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Resolve customer block. customer_id wins when supplied —
        // pulling the canonical name/phone/email/company off the
        // customers row keeps the invoice consistent with the customer
        // record (and fills in missing fields the user didn't bother
        // typing into the modal). Free-text fallback supports the
        // walk-in / one-off-payee case the task spec calls out.
        let customerId = req.body && req.body.customer_id ? String(req.body.customer_id) : null;
        let customerName    = req.body && req.body.customer_name    ? String(req.body.customer_name)    : null;
        let customerPhone   = req.body && req.body.customer_phone   ? String(req.body.customer_phone)   : null;
        let customerEmail   = req.body && req.body.customer_email   ? String(req.body.customer_email)   : null;
        let customerCompany = req.body && req.body.customer_company ? String(req.body.customer_company) : null;

        if (customerId) {
            const cQ = await client.query(
                `SELECT customer_id, full_name, phone, email, company_name
                 FROM customers WHERE customer_id = $1`,
                [customerId]
            );
            if (cQ.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Selected customer not found.' });
            }
            const c = cQ.rows[0];
            // Prefer the customers table value, falling back to anything
            // the user typed in the modal (so they can override on a
            // per-invoice basis without editing the customer record).
            customerName    = customerName    || c.full_name    || null;
            customerPhone   = customerPhone   || c.phone        || null;
            customerEmail   = customerEmail   || c.email        || null;
            customerCompany = customerCompany || c.company_name || null;
        }

        // Recompute totals server-side. Same shape as updateInvoice so
        // the printed/emailed copy is consistent regardless of which
        // path created the invoice. `apply_tax: false` zeroes the VAT
        // line for tax-exempt customers / line items.
        const applyTax = req.body && req.body.apply_tax === false ? false : true;
        const taxRateRow = await client.query(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'tax.rate'"
        );
        const taxRate = !applyTax
            ? 0
            : (taxRateRow.rows.length > 0
                ? parseFloat(taxRateRow.rows[0].setting_value) : 0.16);

        let subtotal = 0;
        const cleanItems = items.map((it, idx) => {
            const qty = Number(it.quantity) || 0;
            const unit = Number(it.unit_price) || 0;
            const disc = Number(it.discount) || 0;
            const line = +(qty * unit - disc).toFixed(2);
            subtotal += line;
            // item_type must satisfy the invoice_items CHECK
            // ('product' | 'service' | 'custom'). Derive it from what's
            // actually present so a stale hidden input from the modal
            // can't sneak through with item_type=product but no
            // product_id (same defence as quoteController.normalizeItemType).
            let itemType;
            if (it.product_id) itemType = 'product';
            else if (it.service_id) itemType = 'service';
            else itemType = 'custom';
            return {
                item_type: itemType,
                product_id: it.product_id || null,
                service_id: it.service_id || null,
                description: String(it.description),
                quantity: qty,
                unit_price: unit,
                discount: disc,
                line_total: line,
                sort_order: idx,
            };
        });
        const discountAmount = Number(req.body.discount_amount) || 0;
        const taxable = Math.max(0, subtotal - discountAmount);
        const taxAmount = +(taxable * taxRate).toFixed(2);
        const total = +(taxable + taxAmount).toFixed(2);

        const invoiceNumber = await mintInvoiceNumber(client);

        // Default 30-day net terms if the user didn't pick a due date.
        const dueDate = req.body && req.body.due_date
            ? req.body.due_date
            : (() => {
                const d = new Date();
                d.setDate(d.getDate() + 30);
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            })();

        // Optional explicit status, but default to 'Draft' so the user
        // can keep editing via the Edit-while-Draft modal before issuing.
        const requestedStatus = req.body && req.body.status;
        const status = requestedStatus === 'Issued' ? 'Issued' : 'Draft';

        const insHead = await client.query(
            `INSERT INTO invoices (
                invoice_number, source_kind, source_sale_id, source_quote_id,
                customer_id, customer_name, customer_phone, customer_email, customer_company,
                subtotal, discount_amount, tax_amount, total_amount, amount_paid,
                status, issue_date, due_date, notes, created_by
             ) VALUES (
                $1, 'manual', NULL, NULL,
                $2, $3, $4, $5, $6,
                $7, $8, $9, $10, 0,
                $11, CURRENT_DATE, $12, $13, $14
             )
             RETURNING *`,
            [
                invoiceNumber,
                customerId, customerName, customerPhone, customerEmail, customerCompany,
                subtotal, discountAmount, taxAmount, total,
                status, dueDate, (req.body && req.body.notes) || null,
                req.user ? req.user.user_id : null,
            ]
        );
        const invoice = insHead.rows[0];

        for (const it of cleanItems) {
            await client.query(
                `INSERT INTO invoice_items (
                    invoice_id, item_type, product_id, service_id,
                    description, quantity, unit_price, discount, line_total, sort_order
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [invoice.invoice_id, it.item_type, it.product_id, it.service_id,
                 it.description, it.quantity, it.unit_price, it.discount,
                 it.line_total, it.sort_order]
            );
        }

        await client.query('COMMIT');
        const fresh = await _fetchInvoice(invoice.invoice_id);
        return res.status(201).json(fresh);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[invoices] create failed:', err);
        return res.status(500).json({ error: err.message || 'Server error.' });
    } finally {
        client.release();
    }
}

// POST /api/invoices/:id/email
async function emailInvoice(req, res) {
    try {
        const { id } = req.params;
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ error: 'email is required.' });

        const inv = await _fetchInvoice(id);
        if (!inv) return res.status(404).json({ error: 'Invoice not found.' });

        const storeName = await getSetting('store.name', 'Zachi Computer Centre');
        const storeAddr = await getSetting('store.address', '');
        const storePhone = await getSetting('store.phone', '');
        const storeEmail = await getSetting('store.email', '');
        const storeTpin = await getSetting('store.tpin', '');

        // Banking + mobile-money (v1.0.14). All strings, possibly
        // empty. We suppress the whole block on Paid invoices or when
        // no banking details are configured — same rule as the PDF
        // renderer in services/pdfService.js.
        const bank = {
            name:      await getSetting('store.bank_name',          ''),
            acctName:  await getSetting('store.bank_account_name',  ''),
            acctNo:    await getSetting('store.bank_account_number',''),
            branch:    await getSetting('store.bank_branch',        ''),
            branchCd:  await getSetting('store.bank_branch_code',   ''),
            swift:     await getSetting('store.bank_swift',         ''),
        };
        const momo = {
            provider:  await getSetting('store.momo_provider',      ''),
            number:    await getSetting('store.momo_number',        ''),
        };
        const hasBanking =
            !!(bank.name || bank.acctName || bank.acctNo || bank.branch ||
               bank.branchCd || bank.swift || momo.provider || momo.number);
        const showBanking = hasBanking && inv.status !== 'Paid';

        const bankRows = [
            ['Bank',         bank.name],
            ['Account Name', bank.acctName],
            ['Account No.',  bank.acctNo],
            ['Branch',       bank.branch],
            ['Branch Code',  bank.branchCd],
            ['SWIFT',        bank.swift],
        ].filter(([, v]) => v);
        const momoRows = [
            ['MoMo Provider', momo.provider],
            ['MoMo Number',   momo.number],
        ].filter(([, v]) => v);

        const renderRow = ([label, value]) => `
            <tr>
                <td style="padding:3px 8px;color:#666;width:130px;">${escapeHtml(label)}:</td>
                <td style="padding:3px 8px;color:#222;font-weight:bold;">${escapeHtml(String(value))}</td>
            </tr>`;

        const bankingHtml = showBanking ? `
            <div style="margin-top:20px;padding:12px;background:#f7f9fc;border-left:3px solid #1B3A5C;font-size:13px;">
                <div style="font-weight:bold;color:#1B3A5C;margin-bottom:6px;letter-spacing:1px;">PAYMENT DETAILS</div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    ${bankRows.map(renderRow).join('')}
                    ${momoRows.map(renderRow).join('')}
                </table>
            </div>` : '';

        const itemRows = inv.items.map((it, i) => `
            <tr>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${i + 1}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(it.description)}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${Number(it.quantity)}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${fmtMoney(it.unit_price)}</td>
                <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${fmtMoney(it.line_total)}</td>
            </tr>`).join('');

        const dueStr = inv.due_date
            ? new Date(inv.due_date).toLocaleDateString('en-ZM') : '—';

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
                <h3 style="border-bottom:2px solid #1B3A5C;padding-bottom:4px;margin-top:24px;">
                    TAX INVOICE ${escapeHtml(inv.invoice_number || '')}
                </h3>
                <p style="font-size:13px;">
                    <strong>Bill To:</strong> ${escapeHtml(inv.customer_name || '—')}
                    ${inv.customer_company ? '<br>' + escapeHtml(inv.customer_company) : ''}
                    ${inv.customer_phone ? '<br>Tel: ' + escapeHtml(inv.customer_phone) : ''}
                    <br><strong>Issue Date:</strong> ${escapeHtml(new Date(inv.issue_date || inv.created_at).toLocaleDateString('en-ZM'))}
                    <br><strong>Due Date:</strong> ${escapeHtml(dueStr)}
                </p>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="background:#f5f5f5;">
                        <th style="padding:6px 8px;border:1px solid #ddd;width:30px;">#</th>
                        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Description</th>
                        <th style="padding:6px 8px;border:1px solid #ddd;width:50px;">Qty</th>
                        <th style="padding:6px 8px;border:1px solid #ddd;width:90px;text-align:right;">Unit Price</th>
                        <th style="padding:6px 8px;border:1px solid #ddd;width:100px;text-align:right;">Line Total</th>
                    </tr></thead>
                    <tbody>${itemRows}</tbody>
                </table>
                <table style="width:100%;font-size:13px;margin-top:8px;">
                    <tr><td style="text-align:right;padding:2px 8px;">Subtotal:</td><td style="width:120px;text-align:right;">${fmtMoney(inv.subtotal)}</td></tr>
                    ${Number(inv.discount_amount) > 0 ? `<tr><td style="text-align:right;padding:2px 8px;">Discount:</td><td style="text-align:right;">- ${fmtMoney(inv.discount_amount)}</td></tr>` : ''}
                    <tr><td style="text-align:right;padding:2px 8px;">VAT:</td><td style="text-align:right;">${fmtMoney(inv.tax_amount)}</td></tr>
                    <tr style="font-weight:bold;background:#f5f5f5;"><td style="text-align:right;padding:6px 8px;">TOTAL:</td><td style="text-align:right;padding:6px 8px;">${fmtMoney(inv.total_amount)}</td></tr>
                    ${Number(inv.amount_paid) > 0 ? `<tr><td style="text-align:right;padding:2px 8px;">Amount Paid:</td><td style="text-align:right;">${fmtMoney(inv.amount_paid)}</td></tr>` : ''}
                    <tr><td style="text-align:right;padding:6px 8px;color:#a00;font-weight:bold;">Balance Due:</td><td style="text-align:right;color:#a00;font-weight:bold;">${fmtMoney(Number(inv.total_amount) - Number(inv.amount_paid || 0))}</td></tr>
                </table>
                ${inv.notes ? `<p style="font-size:13px;margin-top:16px;"><strong>Notes:</strong> ${escapeHtml(inv.notes)}</p>` : ''}
                ${bankingHtml}
            </div>`;

        const subject = `Invoice ${inv.invoice_number || ''} - ${storeName}`.trim();

        // Try to attach the PDF; fall back to a signed download link if
        // PDF rendering fails so the customer always gets *something*.
        let pdfBuffer = null;
        let renderErr = null;
        try {
            pdfBuffer = await renderToBuffer(renderInvoicePdf, inv);
        } catch (e) {
            renderErr = e;
            console.error('[emailInvoice] PDF render failed; falling back to link:', e);
        }

        if (pdfBuffer) {
            await sendEmail(email, subject, html, [
                { filename: `Invoice-${inv.invoice_number || inv.invoice_id}.pdf`, content: pdfBuffer },
            ]);
            return res.json({ message: 'Invoice emailed', to: email });
        }

        try {
            const link = buildSignedUrl(req, 'invoice', inv.invoice_id);
            const linkHtml = html +
                `<p style="margin-top:18px;font-size:13px;">
                    PDF copy: <a href="${link.url}">${link.url}</a><br>
                    <small>Link expires ${new Date(link.exp * 1000).toUTCString()}.</small>
                 </p>`;
            await sendEmail(email, subject, linkHtml, []);
            return res.json({ message: 'Invoice emailed (link fallback).', fallback: 'link' });
        } catch (linkErr) {
            console.error('[emailInvoice] link fallback failed:', linkErr);
            return res.status(500).json({
                error: 'Failed to email invoice: ' + (renderErr && renderErr.message || 'unknown error'),
            });
        }
    } catch (err) {
        console.error('[invoices] email failed:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    }
}

// GET /api/invoices/:id/invoice.pdf — auth OR signed-URL.
async function getInvoicePdf(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invoice ID required' });

    const tokenMode = !!(req.query.token && req.query.exp);
    if (tokenMode) {
        if (!verifyToken('invoice', id, req.query.exp, req.query.token)) {
            return res.status(403).json({ error: 'Invalid or expired invoice link' });
        }
    } else if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const inv = await _fetchInvoice(id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
        `inline; filename="invoice-${inv.invoice_number || inv.invoice_id}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    try { await renderInvoicePdf(inv, doc); }
    catch (e) { console.error('[invoices] render failed:', e); }
    doc.end();
}

// GET /api/invoices/:id/invoice-link — mint a signed URL the cashier
// can paste into WhatsApp/SMS.
async function getInvoiceLink(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invoice ID required' });
    const exists = await pool.query('SELECT 1 FROM invoices WHERE invoice_id = $1', [id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    res.json(buildSignedUrl(req, 'invoice', id));
}

module.exports = {
    listInvoices,
    getInvoice,
    createInvoice,
    updateInvoice,
    updateInvoiceStatus,
    recordPayment,
    emailInvoice,
    getInvoicePdf,
    getInvoiceLink,
};
