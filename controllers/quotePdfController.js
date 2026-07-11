/**
 * quotePdfController.js
 *
 * Branded PDF download + signed-URL minter for quotes. Mirrors
 * receiptPdfController so the WhatsApp/SMS link flow works identically
 * for a quote.
 *
 * Routes (wired in routes/quotes.js):
 *   GET /api/quotes/:id/quote.pdf         (auth OR ?token+exp)
 *   GET /api/quotes/:id/quote-link        (auth — mints {url, exp})
 */
'use strict';

const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const {
    renderQuotePdf,
    verifyToken,
    buildSignedUrl,
} = require('../services/pdfService');

async function _fetchQuote(quoteId) {
    const head = await pool.query(`
        SELECT q.*,
               c.full_name    AS customer_name,
               c.email        AS customer_email,
               c.phone        AS customer_phone,
               c.company_name AS customer_company,
               u.full_name    AS staff_name,
               u.username     AS staff_username
        FROM quotes q
        LEFT JOIN customers c ON c.customer_id = q.customer_id
        LEFT JOIN users     u ON u.user_id     = q.created_by
        WHERE q.quote_id = $1`,
        [quoteId]
    );
    if (head.rows.length === 0) return null;
    const items = await pool.query(
        'SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY item_id',
        [quoteId]
    );
    return { ...head.rows[0], items: items.rows };
}

async function getQuotePdf(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Quote ID required' });

    const tokenMode = !!(req.query.token && req.query.exp);
    if (tokenMode) {
        if (!verifyToken('quote', id, req.query.exp, req.query.token)) {
            return res.status(403).json({ error: 'Invalid or expired quote link' });
        }
    } else if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const quote = await _fetchQuote(id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
        `inline; filename="quote-${quote.quote_number || quote.quote_id}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    try { await renderQuotePdf(quote, doc); }
    catch (e) { console.error('[quotePdf] render failed:', e); }
    doc.end();
}

async function getQuoteLink(req, res) {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Quote ID required' });
    const exists = await pool.query('SELECT 1 FROM quotes WHERE quote_id = $1', [id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Quote not found' });
    res.json(buildSignedUrl(req, 'quote', id));
}

module.exports = { getQuotePdf, getQuoteLink };
