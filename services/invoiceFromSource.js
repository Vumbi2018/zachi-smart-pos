/**
 * invoiceFromSource.js
 *
 * Idempotent helpers that materialise an `invoices` row (and its
 * `invoice_items`) from a credit sale or an accepted quotation.
 *
 * Idempotency is enforced by the partial UNIQUE indexes
 * `invoices_source_sale_uniq` / `invoices_source_quote_uniq` plus an
 * `ON CONFLICT DO NOTHING` on the header insert. Replaying the same
 * source repeatedly is therefore safe — at most one invoice exists
 * per credit sale and per accepted quote.
 *
 * BOTH callers MUST pass the active transactional `client` (not the
 * pool) so the invoice creation participates in the same BEGIN/COMMIT
 * as the source mutation. If the outer transaction rolls back, the
 * invoice insert rolls back with it.
 */
'use strict';

/** Build a yyyy-mm-dd from a Date in the server's local TZ. */
function _localDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** Mint INV-YYYYMMDD-NNNN under an advisory lock to avoid races. */
async function _mintInvoiceNumber(client) {
    const today = _localDate(new Date());
    const compact = today.replace(/-/g, '');
    // Advisory lock keyed on date (cheap hash) so two parallel callers
    // for the same day serialise on the SELECT MAX(...) below.
    const lockKey = parseInt(compact, 10);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    const r = await client.query(
        `SELECT invoice_number FROM invoices
         WHERE invoice_number LIKE $1
         ORDER BY invoice_number DESC
         LIMIT 1`,
        [`INV-${compact}-%`]
    );
    let next = 1;
    if (r.rows.length > 0) {
        const last = r.rows[0].invoice_number;
        const m = last.match(/-(\d+)$/);
        if (m) next = parseInt(m[1], 10) + 1;
    }
    return `INV-${compact}-${String(next).padStart(4, '0')}`;
}

async function _ensureInvoiceNumber(client) {
    return _mintInvoiceNumber(client);
}

/**
 * Look up the existing invoice for a source. Returns the row or null.
 * Used by both helpers AFTER the ON CONFLICT to fetch the existing id.
 */
async function _findInvoiceForSource(client, kind, id) {
    const col = kind === 'sale' ? 'source_sale_id' : 'source_quote_id';
    const r = await client.query(
        `SELECT * FROM invoices WHERE ${col} = $1 LIMIT 1`,
        [id]
    );
    return r.rows[0] || null;
}

/**
 * Create an invoice from a credit / partial sale. Returns the invoice
 * row (existing one if it was already created in a prior call).
 *
 * @param {pg.Client} client – the transactional client owning BEGIN
 * @param {string}    saleId – sales.sale_id
 * @param {object}    [opts] – { createdBy }
 */
async function createInvoiceFromSale(client, saleId, opts = {}) {
    if (!saleId) throw new Error('createInvoiceFromSale: saleId required');

    const existing = await _findInvoiceForSource(client, 'sale', saleId);
    if (existing) return existing;

    const saleQ = await client.query(
        `SELECT s.*,
                c.full_name    AS customer_name,
                c.phone        AS customer_phone,
                c.email        AS customer_email,
                c.company_name AS customer_company
         FROM sales s
         LEFT JOIN customers c ON c.customer_id = s.customer_id
         WHERE s.sale_id = $1`,
        [saleId]
    );
    if (saleQ.rows.length === 0) {
        throw new Error(`createInvoiceFromSale: sale ${saleId} not found`);
    }
    const sale = saleQ.rows[0];

    const itemsQ = await client.query(
        `SELECT si.*,
                COALESCE(p.name, sv.service_name, si.description) AS resolved_name
         FROM sale_items si
         LEFT JOIN products  p  ON si.product_id = p.product_id
         LEFT JOIN services  sv ON si.service_id = sv.service_id
         WHERE si.sale_id = $1
         ORDER BY si.item_id`,
        [saleId]
    );

    const invoiceNumber = await _ensureInvoiceNumber(client);
    // Default 30-day net terms on auto-issued invoices.
    const dueDate = sale.due_date
        ? sale.due_date
        : (() => {
            const d = new Date(sale.transaction_date || Date.now());
            d.setDate(d.getDate() + 30);
            return _localDate(d);
        })();

    const ins = await client.query(
        `INSERT INTO invoices (
            invoice_number, source_kind, source_sale_id, customer_id,
            customer_name, customer_phone, customer_email, customer_company,
            subtotal, discount_amount, tax_amount, total_amount, amount_paid,
            status, issue_date, due_date, notes, created_by
         ) VALUES (
            $1, 'sale', $2, $3,
            $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            'Issued', CURRENT_DATE, $13, $14, $15
         )
         ON CONFLICT (source_sale_id) WHERE source_sale_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
            invoiceNumber, saleId, sale.customer_id,
            sale.customer_name, sale.customer_phone, sale.customer_email, sale.customer_company,
            sale.subtotal, sale.discount_amount, sale.tax_amount, sale.total_amount,
            sale.amount_paid || 0,
            dueDate,
            sale.notes || null,
            opts.createdBy || sale.staff_id,
        ]
    );

    // Conflict path: another concurrent caller raced us — fetch theirs.
    if (ins.rows.length === 0) {
        return _findInvoiceForSource(client, 'sale', saleId);
    }
    const invoice = ins.rows[0];

    let order = 0;
    for (const it of itemsQ.rows) {
        await client.query(
            `INSERT INTO invoice_items (
                invoice_id, item_type, product_id, service_id,
                description, quantity, unit_price, discount, line_total, sort_order
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                invoice.invoice_id,
                it.item_type || 'product',
                it.product_id || null,
                it.service_id || null,
                it.resolved_name || it.description || 'Item',
                it.quantity,
                it.unit_price,
                it.discount || 0,
                it.line_total,
                // Live DB has UUID item_id columns — sort_order is INT,
                // so use the iteration index (positional ordering is all
                // we actually need for display).
                order++,
            ]
        );
    }

    return invoice;
}

/**
 * Create an invoice from an accepted quote. Returns the invoice row
 * (existing one if it was already created in a prior call).
 */
async function createInvoiceFromQuote(client, quoteId, opts = {}) {
    if (!quoteId) throw new Error('createInvoiceFromQuote: quoteId required');

    const existing = await _findInvoiceForSource(client, 'quote', quoteId);
    if (existing) return existing;

    const quoteQ = await client.query(
        `SELECT q.*,
                c.full_name    AS customer_name,
                c.phone        AS customer_phone,
                c.email        AS customer_email,
                c.company_name AS customer_company
         FROM quotes q
         LEFT JOIN customers c ON c.customer_id = q.customer_id
         WHERE q.quote_id = $1`,
        [quoteId]
    );
    if (quoteQ.rows.length === 0) {
        throw new Error(`createInvoiceFromQuote: quote ${quoteId} not found`);
    }
    const quote = quoteQ.rows[0];

    const itemsQ = await client.query(
        `SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY item_id`,
        [quoteId]
    );

    const invoiceNumber = await _ensureInvoiceNumber(client);
    const dueDate = quote.valid_until
        ? quote.valid_until
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() + 30);
            return _localDate(d);
        })();

    const ins = await client.query(
        `INSERT INTO invoices (
            invoice_number, source_kind, source_quote_id, customer_id,
            customer_name, customer_phone, customer_email, customer_company,
            subtotal, discount_amount, tax_amount, total_amount, amount_paid,
            status, issue_date, due_date, notes, created_by
         ) VALUES (
            $1, 'quote', $2, $3,
            $4, $5, $6, $7,
            $8, $9, $10, $11, 0,
            'Issued', CURRENT_DATE, $12, $13, $14
         )
         ON CONFLICT (source_quote_id) WHERE source_quote_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
            invoiceNumber, quoteId, quote.customer_id,
            quote.customer_name, quote.customer_phone, quote.customer_email, quote.customer_company,
            quote.subtotal, quote.discount_amount, quote.tax_amount, quote.total_amount,
            dueDate,
            quote.notes || null,
            opts.createdBy || quote.created_by,
        ]
    );

    if (ins.rows.length === 0) {
        return _findInvoiceForSource(client, 'quote', quoteId);
    }
    const invoice = ins.rows[0];

    let order = 0;
    for (const it of itemsQ.rows) {
        await client.query(
            `INSERT INTO invoice_items (
                invoice_id, item_type, product_id, service_id,
                description, quantity, unit_price, discount, line_total, sort_order
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                invoice.invoice_id,
                it.item_type || 'product',
                it.product_id || null,
                it.service_id || null,
                it.description || 'Item',
                it.quantity,
                it.unit_price,
                it.discount || 0,
                it.line_total,
                order++,
            ]
        );
    }

    return invoice;
}

module.exports = {
    createInvoiceFromSale,
    createInvoiceFromQuote,
    // Exported so the manual-invoice path in invoiceController.createInvoice
    // can mint INV-YYYYMMDD-NNNN under the same advisory lock as the
    // auto-issue paths — keeping ONE source of truth for the format.
    mintInvoiceNumber: _mintInvoiceNumber,
};
