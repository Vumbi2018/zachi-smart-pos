/**
 * pdfService.js
 *
 * Single source of truth for the three branded PDF documents the POS
 * generates: receipts, quotations, and invoices. Centralising the
 * letterhead + table layout means the Director re-brands once
 * (system_settings store.* keys) and every document picks it up.
 *
 * Also owns signed-URL minting / verification for the public download
 * endpoints. Tokens are HMAC-SHA256 over `${kind}.${id}.${exp}` keyed
 * with SESSION_SECRET (or JWT_SECRET as a fallback) so a receipt token
 * cannot be replayed against the invoice endpoint and vice-versa.
 *
 * BACKWARDS COMPAT: the v1.0.12 receipt URLs were signed with just
 * `${saleId}.${exp}` (no kind prefix). When verifying a `receipt` kind
 * we accept BOTH the new and the legacy payload so previously-shared
 * WhatsApp/SMS links keep working through their 7-day TTL.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { getSetting } = require('../utils/settingsCache');

// ──────────────────────────────────────────────────────────────────
// Signing
// ──────────────────────────────────────────────────────────────────

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const SIGN_SECRET =
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('PDF signing requires SESSION_SECRET or JWT_SECRET in production'); })()
        : 'dev-fallback-not-for-prod');

const ALLOWED_KINDS = new Set(['receipt', 'quote', 'invoice']);

function _hmac(payload) {
    return crypto.createHmac('sha256', SIGN_SECRET).update(payload).digest('hex');
}

function signToken(kind, id, expSec) {
    if (!ALLOWED_KINDS.has(kind)) throw new Error(`unknown PDF kind: ${kind}`);
    return _hmac(`${kind}.${id}.${expSec}`);
}

/**
 * Constant-time compare of two hex strings. Tolerates the legacy
 * receipt token format (no `kind` prefix) when verifying receipt URLs.
 */
function verifyToken(kind, id, expRaw, tokenRaw) {
    if (!ALLOWED_KINDS.has(kind)) return false;
    const exp = parseInt(expRaw, 10);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    if (typeof tokenRaw !== 'string' || !/^[0-9a-f]+$/i.test(tokenRaw)) return false;

    const candidates = [signToken(kind, id, exp)];
    if (kind === 'receipt') {
        // v1.0.12 format: HMAC over `${saleId}.${exp}` only.
        candidates.push(_hmac(`${id}.${exp}`));
    }

    for (const expected of candidates) {
        if (tokenRaw.length !== expected.length) continue;
        try {
            if (crypto.timingSafeEqual(Buffer.from(tokenRaw), Buffer.from(expected))) {
                return true;
            }
        } catch (_) { /* fall through */ }
    }
    return false;
}

/**
 * Build {url, exp, token} for any of the three kinds. The route path
 * differs per kind so the public mount maps cleanly:
 *   receipt → /api/sales/:id/receipt.pdf
 *   quote   → /api/quotes/:id/quote.pdf
 *   invoice → /api/invoices/:id/invoice.pdf
 */
function buildSignedUrl(req, kind, id) {
    if (!ALLOWED_KINDS.has(kind)) throw new Error(`unknown PDF kind: ${kind}`);
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const token = signToken(kind, id, exp);
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https')
        .split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host');

    let pathPart;
    if (kind === 'receipt') pathPart = `/api/sales/${id}/receipt.pdf`;
    else if (kind === 'quote') pathPart = `/api/quotes/${id}/quote.pdf`;
    else /* invoice */         pathPart = `/api/invoices/${id}/invoice.pdf`;

    return {
        url: `${proto}://${host}${pathPart}?token=${token}&exp=${exp}`,
        exp,
        token,
    };
}

// ──────────────────────────────────────────────────────────────────
// Shared rendering helpers
// ──────────────────────────────────────────────────────────────────

function K(n) {
    return 'K ' + Number(n || 0).toFixed(2);
}

function _resolveLogoPath(logoSetting) {
    const rel = (logoSetting || '/logo.png').replace(/^\/+/, '');
    const abs = path.join(__dirname, '..', 'public', rel);
    return fs.existsSync(abs) ? abs : null;
}

async function _loadStore() {
    return {
        name:    await getSetting('store.name',    'Zachi Computer Centre'),
        tagline: await getSetting('store.tagline', ''),
        address: await getSetting('store.address', ''),
        phone:   await getSetting('store.phone',   ''),
        email:   await getSetting('store.email',   ''),
        tpin:    await getSetting('store.tpin',    ''),
        phone2:  await getSetting('store.phone2',  ''),
        email2:  await getSetting('store.email2',  ''),
        logoUrl: await getSetting('store.logo_url','/logo.png'),
        // Banking + mobile-money — invoice-only (v1.0.14, migration 020).
        // Always strings (possibly empty). Renderers must treat
        // "all blank" as "skip the block".
        bankName:          await getSetting('store.bank_name',          ''),
        bankAccountName:   await getSetting('store.bank_account_name',  ''),
        bankAccountNumber: await getSetting('store.bank_account_number',''),
        bankBranch:        await getSetting('store.bank_branch',        ''),
        bankBranchCode:    await getSetting('store.bank_branch_code',   ''),
        bankSwift:         await getSetting('store.bank_swift',         ''),
        momoProvider:      await getSetting('store.momo_provider',      ''),
        momoNumber:        await getSetting('store.momo_number',        ''),
    };
}

/**
 * Returns true iff at least one banking-or-momo field on the store is
 * non-empty. Used by the invoice renderer (and by the email/WA/SMS
 * helpers) to decide whether to draw the "Payment Details" block at
 * all. Keeping the predicate here avoids drift between the PDF and the
 * other channels.
 */
function _hasBankingDetails(store) {
    return Boolean(
        store.bankName || store.bankAccountName || store.bankAccountNumber ||
        store.bankBranch || store.bankBranchCode || store.bankSwift ||
        store.momoProvider || store.momoNumber
    );
}

/**
 * Draws a compact "Payment Details" block (bank rows on the left,
 * mobile-money rows on the right) starting at the given y position.
 * Returns the y immediately below the block.
 *
 * Caller is responsible for the suppression rule:
 *   - status === 'Paid'                → DO NOT call.
 *   - !_hasBankingDetails(store)       → DO NOT call.
 */
function _drawBankingBlock(doc, store, y) {
    // Section heading
    doc.fillColor('#1B3A5C').font('Helvetica-Bold').fontSize(10)
       .text('PAYMENT DETAILS', 50, y);
    doc.moveTo(50, y + 13).lineTo(550, y + 13)
       .strokeColor('#1B3A5C').lineWidth(0.5).stroke();
    let cy = y + 18;

    // Two-column layout: bank on the left, mobile-money on the right.
    const leftX = 50, rightX = 310, labelW = 90, valStart = 0;
    const bankRows = [
        ['Bank',          store.bankName],
        ['Account Name',  store.bankAccountName],
        ['Account No.',   store.bankAccountNumber],
        ['Branch',        store.bankBranch],
        ['Branch Code',   store.bankBranchCode],
        ['SWIFT',         store.bankSwift],
    ].filter(([, v]) => v);

    const momoRows = [
        ['MoMo Provider', store.momoProvider],
        ['MoMo Number',   store.momoNumber],
    ].filter(([, v]) => v);

    doc.font('Helvetica').fontSize(9);
    const rowH = 12;

    // Render the two columns side-by-side. Each row paints a label
    // (grey) and a bold value. Track the tallest column so we can
    // return a clean y below the block.
    bankRows.forEach(([label, val], i) => {
        const ry = cy + i * rowH;
        doc.fillColor('#666').font('Helvetica').text(label + ':', leftX, ry, { width: labelW });
        doc.fillColor('#222').font('Helvetica-Bold').text(String(val), leftX + labelW + valStart, ry, { width: 160 });
    });
    momoRows.forEach(([label, val], i) => {
        const ry = cy + i * rowH;
        doc.fillColor('#666').font('Helvetica').text(label + ':', rightX, ry, { width: labelW });
        doc.fillColor('#222').font('Helvetica-Bold').text(String(val), rightX + labelW + valStart, ry, { width: 140 });
    });

    const usedRows = Math.max(bankRows.length, momoRows.length);
    return cy + usedRows * rowH + 6;
}

/**
 * Draws the shared header (logo + name + tagline + contact line + TPIN
 * + horizontal rule) onto the given PDFKit doc. After this returns the
 * caller can move to y=145 for the document title.
 */
function _drawLetterhead(doc, store) {
    const logoPath = _resolveLogoPath(store.logoUrl);
    if (logoPath) {
        try { doc.image(logoPath, 50, 45, { width: 70 }); }
        catch (_) { /* unsupported image format — skip */ }
    }
    doc.fillColor('#1B3A5C').fontSize(18).font('Helvetica-Bold').text(store.name, 140, 50);
    doc.fillColor('#555').fontSize(9).font('Helvetica');
    if (store.tagline) doc.text(store.tagline, 140);
    if (store.address) doc.text(store.address, 140);
    // v1.0.15 — render primary + optional secondary phone/email so the
    // business can publish two contact channels (e.g. landline + mobile,
    // sales + accounts inbox) without overflowing the header line.
    const phones  = [store.phone,  store.phone2].filter(Boolean).join(' / ');
    const emails  = [store.email,  store.email2].filter(Boolean).join(' / ');
    const contact = [
        phones && `Tel: ${phones}`,
        emails && `Email: ${emails}`,
    ].filter(Boolean).join('  |  ');
    if (contact) doc.text(contact, 140);
    if (store.tpin) doc.text(`TPIN: ${store.tpin}`, 140);
    doc.moveTo(50, 130).lineTo(550, 130).strokeColor('#1B3A5C').lineWidth(2).stroke();
}

function _drawTitle(doc, title) {
    doc.fillColor('#1B3A5C').fontSize(16).font('Helvetica-Bold')
       .text(title, 50, 145, { align: 'center', characterSpacing: 4 });
}

/**
 * Draws the "#  DESCRIPTION  QTY  UNIT PRICE  LINE TOTAL" table.
 * Returns the y-position immediately below the last row so the caller
 * can drop totals beneath it.
 */
function _drawItemsTable(doc, items, tableTop) {
    doc.rect(50, tableTop, 500, 22).fillColor('#1B3A5C').fill();
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
    doc.text('#', 56, tableTop + 7);
    doc.text('DESCRIPTION', 80, tableTop + 7);
    doc.text('QTY', 340, tableTop + 7, { width: 40, align: 'center' });
    doc.text('UNIT PRICE', 380, tableTop + 7, { width: 80, align: 'right' });
    doc.text('LINE TOTAL', 460, tableTop + 7, { width: 85, align: 'right' });

    let y = tableTop + 28;
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    (items || []).forEach((it, idx) => {
        if (idx % 2 === 1) {
            doc.rect(50, y - 3, 500, 18).fillColor('#f7f9fc').fill();
        }
        doc.fillColor('#222');
        doc.text(String(idx + 1), 56, y);
        doc.text(String(it.description || it.name || 'Item'), 80, y, { width: 250, ellipsis: true });
        doc.text(String(it.quantity), 340, y, { width: 40, align: 'center' });
        doc.text(K(it.unit_price), 380, y, { width: 80, align: 'right' });
        doc.text(K(it.line_total), 460, y, { width: 85, align: 'right' });
        y += 18;
    });
    return y;
}

/**
 * v1.0.31 (Task #57) — variant of _drawItemsTable that renders
 * director-removed lines struck through with an audit caption.
 * Removed lines stay in the visible body so the customer can see
 * exactly what changed since the original print; the totals block
 * already excludes them server-side.
 */
function _drawItemsTableWithRemovals(doc, items, tableTop) {
    doc.rect(50, tableTop, 500, 22).fillColor('#1B3A5C').fill();
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
    doc.text('#', 56, tableTop + 7);
    doc.text('DESCRIPTION', 80, tableTop + 7);
    doc.text('QTY', 340, tableTop + 7, { width: 40, align: 'center' });
    doc.text('UNIT PRICE', 380, tableTop + 7, { width: 80, align: 'right' });
    doc.text('LINE TOTAL', 460, tableTop + 7, { width: 85, align: 'right' });

    let y = tableTop + 28;
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    (items || []).forEach((it, idx) => {
        const isRemoved = !!it.removed_at;
        const rowH = isRemoved ? 30 : 18;
        if (idx % 2 === 1) {
            doc.rect(50, y - 3, 500, rowH).fillColor(isRemoved ? '#fff5f5' : '#f7f9fc').fill();
        } else if (isRemoved) {
            doc.rect(50, y - 3, 500, rowH).fillColor('#fff5f5').fill();
        }
        const inkColor = isRemoved ? '#888' : '#222';
        doc.fillColor(inkColor);
        const desc = String(it.description || it.name || 'Item');
        doc.text(String(idx + 1), 56, y);
        doc.text(desc, 80, y, { width: 250, ellipsis: true, strike: isRemoved });
        doc.text(String(it.quantity), 340, y, { width: 40, align: 'center', strike: isRemoved });
        doc.text(K(it.unit_price), 380, y, { width: 80, align: 'right', strike: isRemoved });
        doc.text(K(it.line_total), 460, y, { width: 85, align: 'right', strike: isRemoved });
        if (isRemoved) {
            const when = it.removed_at ? new Date(it.removed_at).toLocaleString('en-ZM') : '';
            const who  = it.removed_by_name ? ` by ${it.removed_by_name}` : '';
            const why  = it.removed_reason ? ` — ${it.removed_reason}` : '';
            doc.fillColor('#a00').font('Helvetica-Oblique').fontSize(8);
            doc.text(`  Removed${who}${when ? ' on ' + when : ''}${why}`, 80, y + 12, { width: 460 });
            doc.font('Helvetica').fontSize(9);
        }
        y += rowH;
    });
    return y;
}

function _drawTotalsBlock(doc, { subtotal, discount, tax, total }, y) {
    const rows = [
        ['Subtotal', K(subtotal)],
        Number(discount) > 0 ? ['Discount', '- ' + K(discount)] : null,
        ['VAT', K(tax)],
    ].filter(Boolean);
    rows.forEach(([label, val]) => {
        doc.font('Helvetica').fillColor('#444').text(label, 380, y, { width: 80, align: 'right' });
        doc.font('Helvetica-Bold').fillColor('#222').text(val, 460, y, { width: 85, align: 'right' });
        y += 14;
    });
    y += 4;
    doc.rect(380, y, 165, 26).fillColor('#1B3A5C').fill();
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11);
    doc.text('TOTAL', 388, y + 8);
    doc.text(K(total), 460, y + 8, { width: 80, align: 'right' });
    return y + 36;
}

function _drawFooter(doc, line, secondLine) {
    doc.moveTo(50, 740).lineTo(550, 740).dash(2, { space: 2 })
       .strokeColor('#888').stroke().undash();
    doc.fillColor('#666').font('Helvetica').fontSize(8);
    doc.text(line, 50, 750, { width: 500, align: 'center' });
    if (secondLine) {
        doc.text(secondLine, 50, 778, { width: 500, align: 'center' });
    }
}

// ──────────────────────────────────────────────────────────────────
// Receipt
// ──────────────────────────────────────────────────────────────────

async function renderReceiptPdf(sale, doc) {
    const store = await _loadStore();
    _drawLetterhead(doc, store);
    _drawTitle(doc, 'OFFICIAL RECEIPT');

    const metaTop = 180;
    doc.fontSize(9).font('Helvetica').fillColor('#222');
    doc.text(`Receipt No:`, 50, metaTop);
    doc.font('Helvetica-Bold').text(sale.sale_number || sale.sale_id, 130, metaTop);
    doc.font('Helvetica').text(`Date:`, 50, metaTop + 14);
    doc.font('Helvetica-Bold').text(
        new Date(sale.transaction_date || Date.now()).toLocaleString('en-ZM'),
        130, metaTop + 14
    );
    doc.font('Helvetica').text(`Served by:`, 50, metaTop + 28);
    doc.font('Helvetica-Bold').text(sale.staff_name || sale.staff_username || '—', 130, metaTop + 28);

    if (sale.customer_name) {
        doc.font('Helvetica').text(`Customer:`, 320, metaTop);
        doc.font('Helvetica-Bold').text(sale.customer_name, 380, metaTop);
        if (sale.customer_phone) {
            doc.font('Helvetica').text(`Phone:`, 320, metaTop + 14);
            doc.font('Helvetica-Bold').text(sale.customer_phone, 380, metaTop + 14);
        }
        if (sale.customer_email) {
            doc.font('Helvetica').text(`Email:`, 320, metaTop + 28);
            doc.font('Helvetica-Bold').text(sale.customer_email, 380, metaTop + 28);
        }
    }

    // v1.0.31 (Task #57) — Per-line refund. The receipt is reprintable
    // after a director removes a line, so the PDF renders every line
    // including removed ones — removed lines appear struck through with
    // an audit caption ("Removed by <director> on <date> — <reason>")
    // beneath. Totals (already recomputed server-side post-remove)
    // exclude the struck lines.
    let y = _drawItemsTableWithRemovals(doc, sale.items || [], 240);
    y = _drawTotalsBlock(doc, {
        subtotal: sale.subtotal,
        discount: sale.discount_amount,
        tax: sale.tax_amount,
        total: sale.total_amount,
    }, y + 10);

    // Payment breakdown
    const paid = Number(sale.amount_paid || 0);
    const balance = Math.max(0, Number(sale.total_amount || 0) - paid);
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    doc.text(`Paid via ${sale.payment_method || 'Cash'}:`, 380, y, { width: 80, align: 'right' });
    doc.font('Helvetica-Bold').text(K(paid), 460, y, { width: 85, align: 'right' });
    y += 14;
    if (balance > 0) {
        doc.font('Helvetica-Bold').fillColor('#a00');
        doc.text('Balance Due:', 380, y, { width: 80, align: 'right' });
        doc.text(K(balance), 460, y, { width: 85, align: 'right' });
        y += 16;
        doc.rect(380, y, 165, 18).strokeColor('#a00').lineWidth(1).stroke();
        doc.fillColor('#a00').font('Helvetica-Bold').fontSize(9)
           .text(`${(sale.payment_status || 'Credit').toUpperCase()} — ON ACCOUNT`,
                 380, y + 5, { width: 165, align: 'center' });
    } else {
        doc.fillColor('#1a7a3c').font('Helvetica-Bold')
           .text('PAID IN FULL', 380, y, { width: 165, align: 'right' });
    }

    _drawFooter(doc,
        `Thank you for shopping at ${store.name}. Goods sold are NOT returnable unless defective. Exchange only within 7 days with receipt.`,
        `Printed: ${new Date().toLocaleString('en-ZM')}`
    );
}

// ──────────────────────────────────────────────────────────────────
// Quote
// ──────────────────────────────────────────────────────────────────

async function renderQuotePdf(quote, doc) {
    const store = await _loadStore();
    _drawLetterhead(doc, store);
    _drawTitle(doc, 'QUOTATION');

    const metaTop = 180;
    doc.fontSize(9).font('Helvetica').fillColor('#222');
    doc.text(`Quote No:`, 50, metaTop);
    doc.font('Helvetica-Bold').text(quote.quote_number || quote.quote_id, 130, metaTop);
    doc.font('Helvetica').text(`Date:`, 50, metaTop + 14);
    doc.font('Helvetica-Bold').text(
        new Date(quote.created_at || Date.now()).toLocaleString('en-ZM'),
        130, metaTop + 14
    );
    if (quote.valid_until) {
        doc.font('Helvetica').text(`Valid Until:`, 50, metaTop + 28);
        doc.font('Helvetica-Bold').text(
            new Date(quote.valid_until).toLocaleDateString('en-ZM'),
            130, metaTop + 28
        );
    }
    doc.font('Helvetica').text(`Prepared By:`, 50, metaTop + 42);
    doc.font('Helvetica-Bold').text(quote.staff_name || quote.staff_username || '—', 130, metaTop + 42);

    if (quote.customer_name) {
        doc.font('Helvetica').text(`Bill To:`, 320, metaTop);
        doc.font('Helvetica-Bold').text(quote.customer_name, 380, metaTop);
        let cy = metaTop + 14;
        if (quote.customer_company) {
            doc.font('Helvetica').text(quote.customer_company, 380, cy); cy += 14;
        }
        if (quote.customer_phone) {
            doc.font('Helvetica').text(`Tel: ${quote.customer_phone}`, 380, cy); cy += 14;
        }
        if (quote.customer_email) {
            doc.font('Helvetica').text(quote.customer_email, 380, cy);
        }
    }

    let y = _drawItemsTable(doc, quote.items, 250);
    y = _drawTotalsBlock(doc, {
        subtotal: quote.subtotal,
        discount: quote.discount_amount,
        tax: quote.tax_amount,
        total: quote.total_amount,
    }, y + 10);

    if (quote.notes) {
        doc.fillColor('#444').font('Helvetica').fontSize(9);
        doc.text(`Notes: ${quote.notes}`, 50, y + 8, { width: 500 });
    }

    _drawFooter(doc,
        `Thank you for considering ${store.name}.` +
        (quote.valid_until
            ? ` This quotation is valid until ${new Date(quote.valid_until).toLocaleDateString('en-ZM')}.`
            : ''),
        `Generated ${new Date().toLocaleString('en-ZM')}`
    );
}

// ──────────────────────────────────────────────────────────────────
// Invoice
// ──────────────────────────────────────────────────────────────────

async function renderInvoicePdf(invoice, doc) {
    const store = await _loadStore();
    _drawLetterhead(doc, store);
    _drawTitle(doc, 'TAX INVOICE');

    const metaTop = 180;
    doc.fontSize(9).font('Helvetica').fillColor('#222');
    doc.text(`Invoice No:`, 50, metaTop);
    doc.font('Helvetica-Bold').text(invoice.invoice_number || invoice.invoice_id, 130, metaTop);
    doc.font('Helvetica').text(`Issue Date:`, 50, metaTop + 14);
    doc.font('Helvetica-Bold').text(
        new Date(invoice.issue_date || invoice.created_at || Date.now()).toLocaleDateString('en-ZM'),
        130, metaTop + 14
    );
    if (invoice.due_date) {
        doc.font('Helvetica').text(`Due Date:`, 50, metaTop + 28);
        doc.font('Helvetica-Bold').text(
            new Date(invoice.due_date).toLocaleDateString('en-ZM'),
            130, metaTop + 28
        );
    }
    doc.font('Helvetica').text(`Status:`, 50, metaTop + 42);
    doc.font('Helvetica-Bold').text(invoice.status || 'Draft', 130, metaTop + 42);

    if (invoice.customer_name) {
        doc.font('Helvetica').text(`Bill To:`, 320, metaTop);
        doc.font('Helvetica-Bold').text(invoice.customer_name, 380, metaTop);
        let cy = metaTop + 14;
        if (invoice.customer_company) {
            doc.font('Helvetica').text(invoice.customer_company, 380, cy); cy += 14;
        }
        if (invoice.customer_phone) {
            doc.font('Helvetica').text(`Tel: ${invoice.customer_phone}`, 380, cy); cy += 14;
        }
        if (invoice.customer_email) {
            doc.font('Helvetica').text(invoice.customer_email, 380, cy);
        }
    }

    let y = _drawItemsTable(doc, invoice.items, 250);
    y = _drawTotalsBlock(doc, {
        subtotal: invoice.subtotal,
        discount: invoice.discount_amount,
        tax: invoice.tax_amount,
        total: invoice.total_amount,
    }, y + 10);

    // Balance summary
    const paid = Number(invoice.amount_paid || 0);
    const balance = Math.max(0, Number(invoice.total_amount || 0) - paid);
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    doc.text(`Amount Paid:`, 380, y, { width: 80, align: 'right' });
    doc.font('Helvetica-Bold').text(K(paid), 460, y, { width: 85, align: 'right' });
    y += 14;
    if (balance > 0) {
        doc.font('Helvetica-Bold').fillColor('#a00');
        doc.text('Balance Due:', 380, y, { width: 80, align: 'right' });
        doc.text(K(balance), 460, y, { width: 85, align: 'right' });
    } else {
        doc.fillColor('#1a7a3c').font('Helvetica-Bold')
           .text('PAID IN FULL', 380, y, { width: 165, align: 'right' });
    }

    if (invoice.notes) {
        doc.fillColor('#444').font('Helvetica').fontSize(9);
        doc.text(`Notes: ${invoice.notes}`, 50, y + 22, { width: 500 });
        y += 22 + 14; // approximate line height for a one-line note
    } else {
        y += 22;
    }

    // Banking / mobile-money block. Suppress entirely when the
    // invoice has been settled OR when the store has no banking
    // details configured — there's no useful "please pay" prompt.
    if (invoice.status !== 'Paid' && _hasBankingDetails(store)) {
        // Leave a small gap; cap y so we don't crash into the footer.
        const blockTop = Math.min(y + 6, 660);
        _drawBankingBlock(doc, store, blockTop);
    }

    _drawFooter(doc,
        `Please make payment by ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-ZM') : 'the due date'}. Thank you for your business.`,
        `Generated ${new Date().toLocaleString('en-ZM')}`
    );
}

// ──────────────────────────────────────────────────────────────────
// Buffer helper — useful for email attachments
// ──────────────────────────────────────────────────────────────────

/**
 * Run a renderXxxPdf function and resolve to a complete Buffer. The
 * caller doesn't have to set up the doc, sink, or end-event plumbing.
 */
async function renderToBuffer(renderFn, payload) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => {
        doc.on('end', resolve);
        doc.on('error', reject);
    });
    try {
        await renderFn(payload, doc);
        doc.end();
        await done;
        return Buffer.concat(chunks);
    } catch (e) {
        try { doc.end(); } catch (_) { /* may already be torn down */ }
        throw e;
    }
}

module.exports = {
    // Renderers
    renderReceiptPdf,
    renderQuotePdf,
    renderInvoicePdf,
    renderToBuffer,
    // Signing
    signToken,
    verifyToken,
    buildSignedUrl,
    TOKEN_TTL_SECONDS,
};
