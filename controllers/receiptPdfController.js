/**
 * receiptPdfController.js
 *
 * Thin wrapper around services/pdfService for the sales receipt
 * routes. Kept as its own file so the existing imports from
 * routes/sales.js and salesController.emailReceipt
 * (`renderReceiptPdf`, `buildPublicReceiptUrl`) keep working without
 * touching every call site.
 *
 * Two access modes:
 *   1. Authenticated: GET /api/sales/:id/receipt.pdf
 *   2. Signed-token URL: GET /api/sales/:id/receipt.pdf?token=...&exp=...
 *      (verifyToken accepts both the new `${kind}.${id}.${exp}` payload
 *       and the legacy `${id}.${exp}` payload from v1.0.12, so links
 *       minted before the upgrade keep working through their TTL.)
 */
'use strict';

const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const {
    renderReceiptPdf,
    verifyToken,
    buildSignedUrl,
} = require('../services/pdfService');

async function fetchSale(saleId) {
    const sale = await pool.query(`
        SELECT s.*,
               c.full_name    AS customer_name,
               c.phone        AS customer_phone,
               c.email        AS customer_email,
               u.full_name    AS staff_name,
               u.username     AS staff_username,
               COALESCE(cp.paid_so_far, 0) AS credit_paid_so_far
        FROM sales s
        LEFT JOIN customers c ON c.customer_id = s.customer_id
        LEFT JOIN users     u ON u.user_id     = s.staff_id
        LEFT JOIN (
            SELECT sale_id, SUM(amount) AS paid_so_far
            FROM credit_payments
            GROUP BY sale_id
        ) cp ON cp.sale_id = s.sale_id
        WHERE s.sale_id = $1
    `, [saleId]);

    if (sale.rows.length === 0) return null;

    // v1.0.31 (Task #57) — surface removed_by_name so the receipt PDF
    // can render "removed by <director>" under the struck audit block.
    const items = await pool.query(`
        SELECT si.*, ru.full_name AS removed_by_name
          FROM sale_items si
          LEFT JOIN users ru ON si.removed_by = ru.user_id
         WHERE si.sale_id = $1
         ORDER BY si.item_id
    `, [saleId]);

    return { ...sale.rows[0], items: items.rows };
}

/**
 * Build a {url, exp, token} bundle the cashier can drop into WhatsApp.
 * Re-exported for salesController.emailReceipt's link-fallback path.
 */
function buildPublicReceiptUrl(req, saleId) {
    return buildSignedUrl(req, 'receipt', saleId);
}

async function getReceiptPdf(req, res) {
    const saleId = req.params.id;
    if (!saleId) return res.status(400).json({ error: 'Sale ID required' });

    const tokenMode = !!(req.query.token && req.query.exp);
    if (tokenMode) {
        if (!verifyToken('receipt', saleId, req.query.exp, req.query.token)) {
            return res.status(403).json({ error: 'Invalid or expired receipt link' });
        }
    } else if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    let sale;
    try {
        sale = await fetchSale(saleId);
    } catch (err) {
        console.error('[receiptPdf] fetch failed:', err);
        return res.status(500).json({ error: 'Failed to load sale' });
    }
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
        `inline; filename="receipt-${sale.sale_number || sale.sale_id}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    try {
        await renderReceiptPdf(sale, doc);
    } catch (err) {
        console.error('[receiptPdf] render failed:', err);
    }
    doc.end();
}

async function getReceiptLink(req, res) {
    const saleId = req.params.id;
    if (!saleId) return res.status(400).json({ error: 'Sale ID required' });
    const exists = await pool.query('SELECT 1 FROM sales WHERE sale_id = $1', [saleId]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Sale not found' });
    res.json(buildPublicReceiptUrl(req, saleId));
}

module.exports = {
    getReceiptPdf,
    getReceiptLink,
    renderReceiptPdf,
    buildPublicReceiptUrl,
};
