const pool = require('../db/pool');
const { calculatePrice } = require('../utils/pricing');
const { sendEmail } = require('../utils/email');
const { getNumberSetting } = require('../utils/settingsCache');
const { mintSaleNumber } = require('../utils/saleNumber');
const {
    decrementStock,
    incrementStock,
    redeemLoyaltyPoints,
    earnLoyaltyPoints,
    applyCreditPayment,
    StockGuardError,
    LoyaltyGuardError,
    CreditGuardError,
} = require('../utils/atomicStock');
const path = require('path');
const fs = require('fs');

// Helper: pull device + client_op_id off the request so they can be
// stamped onto the row for provenance / sync replay traceability.
function syncMeta(req) {
    const headerKey = req.headers['x-device-id'];
    const headerOp = req.headers['x-client-op-id'];
    return {
        device_id: (req.body && req.body.device_id) || headerKey || null,
        client_op_id: (req.body && req.body.client_op_id) || headerOp || null,
    };
}

/**
 * Helper: validate `:id` route params before they hit Postgres.
 * Express routes /credit before /:id so this is defensive — it converts
 * any stray non-numeric id (e.g. /sales/credit handled by the wrong route
 * on an older deploy) into a clean 400 instead of a 500.
 */
function parseIdParam(req, res, paramName = 'id') {
    const raw = req.params && req.params[paramName];
    if (typeof raw === 'string' && (
        /^[1-9][0-9]*$/.test(raw) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    )) {
        return raw;
    }
    const label = paramName === 'itemId' ? 'item id' : 'sale id';
    res.status(400).json({ error: `Invalid ${label}: ${raw}` });
    return null;
}

/**
 * POST /api/sales
 * Create a new sale with hybrid cart (products + services)
 */
async function createSale(req, res) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { customer_id, items, payment_method, amount_paid, notes, tax_exempt, discount_amount, points_redeemed, transaction_date, due_date, payments } = req.body || {};

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required.' });
        }

        // ── Split-tender normalisation ────────────────────────────────
        // v1.0.18 introduced a `payments: [{method, amount, reference?}]`
        // array so a single sale can be paid with multiple methods (e.g.
        // K500 cash + K1,200 MTN). When that array is present we derive
        // paidAmount, payment_method ('Mixed' for >1 distinct method),
        // and payment_reference from it. When absent, we keep the
        // legacy single-method payload working byte-for-byte so older
        // clients and the offline sync engine never regress.
        let normalisedTenders = null;
        let resolvedPaymentMethod = payment_method;
        let resolvedPaymentReference = req.body.payment_reference || null;
        let resolvedPaidAmount = amount_paid;

        if (Array.isArray(payments) && payments.length > 0) {
            normalisedTenders = [];
            let tenderSum = 0;
            for (let i = 0; i < payments.length; i++) {
                const t = payments[i] || {};
                const m = String(t.method || '').trim();
                const a = parseFloat(t.amount);
                if (!m) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `payments[${i}].method is required.` });
                }
                if (!Number.isFinite(a) || a < 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `payments[${i}].amount must be a non-negative number.` });
                }
                normalisedTenders.push({
                    seq: i + 1,
                    method: m,
                    amount: parseFloat(a.toFixed(2)),
                    reference: (t.reference || t.payment_reference || '').trim() || null,
                });
                tenderSum += a;
            }
            resolvedPaidAmount = parseFloat(tenderSum.toFixed(2));
            const distinct = [...new Set(normalisedTenders.map(t => t.method))];
            resolvedPaymentMethod = distinct.length > 1 ? 'Mixed' : distinct[0];
            // Surface the first non-empty reference at the sale-header
            // level so existing reports / receipt headers keep showing
            // a transaction number for single-tender mobile-money sales.
            const firstRef = normalisedTenders.find(t => t.reference);
            if (firstRef) resolvedPaymentReference = firstRef.reference;
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
            let productCost = 0; // Initialize productCost

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
                productCost = p.cost_price; // Capture cost price while p is in scope

                // Atomic stock guard: re-checked at the row level so
                // two concurrent syncs from different tablets cannot
                // both pass the earlier `p.stock_quantity` check and
                // oversell the last unit.
                if (!req.body.skip_stock_adjustment) {
                    await decrementStock(client, item.product_id, item.quantity);
                }

            } else if (item.type === 'service') {
                const service = await client.query('SELECT * FROM services WHERE service_id = $1 AND is_active = TRUE', [item.service_id]);
                if (service.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `Service ID ${item.service_id} not found.` });
                }

                const s = service.rows[0];
                unitPrice = item.price_override || calculatePrice(s, item.quantity, item.options);
                description = s.service_name;

            } else if (item.type === 'custom') {
                // [BACKLOG] Freehand custom line item — no catalogue or stock validation
                unitPrice = parseFloat(item.price_override) || 0;
                description = item.description || 'Custom Item';

            } else {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Each item must have type "product", "service", or "custom".' });
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
                cost_price: item.type === 'product' ? productCost : 0,
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

            // Atomic guard: deducts only if the customer currently has
            // enough points; throws LoyaltyGuardError otherwise. This
            // protects against two queued offline sales redeeming the
            // same balance twice when both reach the server.
            const balanceAfter = await redeemLoyaltyPoints(client, customer_id, pointsRedeemed);
            loyaltyDiscount = pointsRedeemed * POINTS_REDEEM_VALUE;

            const meta = syncMeta(req);
            await client.query(
                `INSERT INTO loyalty_transactions
                    (customer_id, transaction_type, points, reference_type, balance_after, notes, device_id, client_op_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [customer_id, 'redeem', pointsRedeemed, 'sale', balanceAfter, 'Redeemed on sale',
                 meta.device_id, meta.client_op_id]
            );
        }

        const totalDiscount = manualDiscount + loyaltyDiscount;
        const taxableAmount = Math.max(0, subtotal - totalDiscount);

        // --- Tax Logic ---
        // Read VAT rate from system_settings (cached) so the Director can
        // change it without redeploying. Falls back to 0.16 if unset.
        const configuredTaxRate = await getNumberSetting('tax.rate', 0.16);
        const taxRate = tax_exempt ? 0 : configuredTaxRate;
        const taxAmount = parseFloat((taxableAmount * taxRate).toFixed(2));
        const totalAmount = parseFloat((taxableAmount + taxAmount).toFixed(2));

        // Use ?? so an explicit `amount_paid: 0` is honored as a credit
        // sale rather than coerced to the full total (truthy fallback bug).
        // For split-tender sales, resolvedPaidAmount is the sum of the
        // tender array — already computed above.
        const paidAmount = resolvedPaidAmount ?? totalAmount;
        const changeDue = Math.max(0, parseFloat((paidAmount - totalAmount).toFixed(2)));
        const paymentStatus = paidAmount >= totalAmount ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Credit');

        // Mint a unique sale number for the day under an advisory lock
        // so that two concurrent sync requests cannot both pick the
        // same sequence number. See utils/saleNumber.js.
        const saleNumber = await mintSaleNumber(client, transaction_date);
        const meta = syncMeta(req);

        // Resolve a deadline for credit / partial sales. The cashier
        // can pass an explicit `due_date` (YYYY-MM-DD); otherwise we
        // default to 30 days after the transaction date so the daily
        // reminder cron has a sensible target. Fully-paid sales never
        // get a deadline (NULL) — the column is meaningless for them.
        let resolvedDueDate = null;
        if (paymentStatus === 'Credit' || paymentStatus === 'Partial') {
            if (due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(due_date))) {
                resolvedDueDate = due_date;
            } else {
                // Compute the deadline in *local* date components so a
                // sale rung up at 23:30 Africa/Lusaka doesn't get a
                // deadline 1 day earlier than expected (which is what
                // `toISOString().slice(0,10)` would produce when the
                // UTC date has already rolled past midnight). Using
                // getFullYear / getMonth / getDate keeps us in the
                // server's local TZ where the sale was rung up.
                const anchor = transaction_date ? new Date(transaction_date) : new Date();
                anchor.setDate(anchor.getDate() + 30);
                const yyyy = anchor.getFullYear();
                const mm = String(anchor.getMonth() + 1).padStart(2, '0');
                const dd = String(anchor.getDate()).padStart(2, '0');
                resolvedDueDate = `${yyyy}-${mm}-${dd}`;
            }
        }

        // Insert sale header
        const saleResult = await client.query(
            `INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount, total_amount, payment_method, payment_status, amount_paid, change_due, notes, payment_reference, transaction_date, device_id, client_op_id, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, CURRENT_TIMESTAMP), $15, $16, $17)
       RETURNING *`,
            [saleNumber, customer_id || null, req.user.user_id, subtotal, taxAmount, totalDiscount, totalAmount,
                resolvedPaymentMethod, paymentStatus, paidAmount, changeDue, notes || null, resolvedPaymentReference, transaction_date,
                meta.device_id, meta.client_op_id, resolvedDueDate]
        );

        const sale = saleResult.rows[0];

        // Insert line items
        for (const item of processedItems) {
            await client.query(
                `INSERT INTO sale_items (sale_id, item_type, product_id, service_id, description, quantity, unit_price, cost_price, discount, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [sale.sale_id, item.item_type, item.product_id, item.service_id, item.description,
                item.quantity, item.unit_price, item.cost_price, item.discount, item.line_total]
            );
        }

        // ── Persist tender breakdown (split-tender, v1.0.18) ─────────
        // Always write at least one sale_payments row so the new
        // breakdown UI and any downstream reports have a uniform view
        // across history (legacy single-tender sales also get one row).
        // For credit sales (paidAmount === 0) we deliberately skip — no
        // money was tendered at the till. The down-payment for a
        // partial sale is captured here AND in credit_payments below
        // (separate ledgers, intentional: sale_payments shows what was
        // tendered at the moment of sale; credit_payments shows the
        // running ledger of installments thereafter).
        if (paidAmount > 0) {
            const tendersToInsert = normalisedTenders && normalisedTenders.length > 0
                ? normalisedTenders
                : [{
                    seq: 1,
                    method: resolvedPaymentMethod || 'Cash',
                    amount: paidAmount,
                    reference: resolvedPaymentReference,
                }];
            for (const t of tendersToInsert) {
                await client.query(
                    `INSERT INTO sale_payments
                        (sale_id, seq, payment_method, amount, payment_reference,
                         tender_type, recorded_by, device_id, client_op_id)
                     VALUES ($1, $2, $3, $4, $5, 'sale', $6, $7, $8)`,
                    [sale.sale_id, t.seq, t.method, t.amount, t.reference,
                     req.user.user_id, meta.device_id, meta.client_op_id]
                );
            }
        }

        // ── Cash drawer movement (split-tender aware) ─────────────────
        // EOD reconciliation aggregates `cash_movements` by movement_type
        // and only counts movement_type='sale' rows toward expected
        // cash-in-drawer. For split-tender sales (e.g. K500 cash +
        // K1,200 MTN) we must record ONLY the cash portion here — the
        // MTN portion is captured in sale_payments and never touches
        // the till. We emit one row per cash tender in payments[] so
        // each cash sub-tender is auditable, and reconciliation sums
        // them correctly. Non-cash tenders (MTN, Airtel, POS-Swipe,
        // etc.) intentionally produce no cash_movements row.
        // Legacy single-tender Cash sales (no payments[] array) write
        // exactly one row equal to amount_paid, preserving the
        // pre-split-tender semantics. Sales with no open cash session (e.g.
        // backlog/sync replay outside an active till shift) skip this
        // step rather than fail the sale.
        if (paidAmount > 0) {
            const tenderRows = normalisedTenders && normalisedTenders.length > 0
                ? normalisedTenders
                : [{
                    seq: 1,
                    method: resolvedPaymentMethod || 'Cash',
                    amount: paidAmount,
                    reference: resolvedPaymentReference,
                }];
            const cashTenders = tenderRows.filter(t =>
                String(t.method || '').trim().toLowerCase() === 'cash'
                && parseFloat(t.amount) > 0
            );
            if (cashTenders.length > 0) {
                const openSession = await client.query(
                    "SELECT session_id FROM cash_sessions WHERE status = 'Open' ORDER BY opened_at DESC LIMIT 1"
                );
                if (openSession.rows.length > 0) {
                    const sessionId = openSession.rows[0].session_id;
                    for (const t of cashTenders) {
                        await client.query(
                            `INSERT INTO cash_movements
                                (session_id, movement_type, amount, description,
                                 reference_type, reference_id, performed_by)
                             VALUES ($1, 'sale', $2, $3, 'sale', $4, $5)`,
                            [sessionId, parseFloat(t.amount).toFixed(2),
                             `Cash for sale ${saleNumber}`, sale.sale_id,
                             req.user.user_id]
                        );
                    }
                }
            }
        }

        // Partial-payment ledger entry: when the cashier rings up a sale
        // as a down-payment + balance-on-credit, log the down-payment as
        // the first credit_payments row so getCreditOrders aggregates
        // it correctly and the customer ledger stays consistent. Full
        // credit (paidAmount === 0) needs no row — the entire total is
        // the outstanding balance. payment_method records the actual
        // tender used for the down-payment (Cash, MTN Money, etc.) so
        // reports per payment-method stay accurate.
        if (paymentStatus === 'Partial' && paidAmount > 0) {
            await client.query(
                `INSERT INTO credit_payments
                    (sale_id, amount, payment_method, payment_reference, notes, recorded_by, device_id, client_op_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [sale.sale_id, paidAmount, resolvedPaymentMethod, resolvedPaymentReference,
                 'Down-payment at sale', req.user.user_id, meta.device_id, meta.client_op_id]
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
                await earnLoyaltyPoints(client, customer_id, pointsEarned);
                await client.query(
                    `INSERT INTO loyalty_transactions
                        (customer_id, transaction_type, points, reference_type, reference_id, notes, device_id, client_op_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [customer_id, 'earn', pointsEarned, 'sale', sale.sale_id,
                     `Earned from Sale ${saleNumber}`, meta.device_id, meta.client_op_id]
                );
            }
        }

        // Auto-invoice for credit / partial sales. Idempotent — the
        // partial UNIQUE on invoices.source_sale_id means a retried
        // sale-create (e.g. sync replay) cannot produce a duplicate
        // invoice. Failures here log but don't fail the sale; an
        // invoice can always be re-issued by hand later.
        if (paymentStatus !== 'Paid') {
            try {
                const { createInvoiceFromSale } = require('../services/invoiceFromSource');
                await createInvoiceFromSale(client, sale.sale_id, { createdBy: req.user.user_id });
            } catch (invErr) {
                console.error('[createSale] auto-invoice failed (sale will still commit):', invErr.message);
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
        // Atomic guard errors are *expected* failure modes (sold-out
        // stock, points already redeemed by another tablet) — surface
        // them as 409 Conflict with a structured payload so the sync
        // engine on the client can move them to `failed_ops` instead
        // of retrying forever.
        if (err instanceof StockGuardError || err instanceof LoyaltyGuardError) {
            console.warn(`[createSale] ${err.code}: ${err.message}`);
            return res.status(409).json({
                error: err.message,
                code: err.code,
                details: err.details,
            });
        }
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
        // v1.0.29 — back-compat split:
        //   • If `?page=` is present we return the canonical
        //     `{rows,total,page,limit}` envelope (and keep the
        //     legacy `sales`/`pagination` keys alongside it for
        //     existing callers).
        //   • Otherwise we return a bare array of sale rows so the
        //     sync engine and any older client that does not
        //     expect an envelope continues to work unchanged.
        const isPaged = Object.prototype.hasOwnProperty.call(req.query, 'page');
        const { date_from, date_to, payment_method, status } = req.query;
        const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
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
            `SELECT s.*, u.full_name AS staff_name, c.full_name AS customer_name,
                    COALESCE(
                        (SELECT json_agg(json_build_object(
                            'seq', sp.seq,
                            'payment_method', sp.payment_method,
                            'amount', sp.amount,
                            'payment_reference', sp.payment_reference,
                            'tender_type', sp.tender_type
                        ) ORDER BY sp.seq)
                         FROM sale_payments sp WHERE sp.sale_id = s.sale_id),
                        '[]'::json
                    ) AS payments
       FROM sales s
       LEFT JOIN users u ON s.staff_id = u.user_id
       LEFT JOIN customers c ON s.customer_id = c.customer_id
       ${where}
       ORDER BY s.transaction_date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        if (isPaged) {
            // Canonical envelope for paged callers; also keep legacy
            // keys so any existing client that already consumes
            // {sales,pagination} continues to work.
            return res.json({
                sales: result.rows,
                pagination: { page, limit, total },
                rows: result.rows,
                total,
                page,
                limit,
            });
        }
        // Legacy bare-array response — preserved for the offline sync
        // engine and any older client that doesn't expect an envelope.
        res.json(result.rows);
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
    const id = parseIdParam(req, res);
    if (id == null) return;
    try {
        const sale = await pool.query(
            `SELECT s.*, u.full_name AS staff_name, c.full_name AS customer_name
       FROM sales s
       LEFT JOIN users u ON s.staff_id = u.user_id
       LEFT JOIN customers c ON s.customer_id = c.customer_id
       WHERE s.sale_id = $1`,
            [id]
        );

        if (sale.rows.length === 0) {
            return res.status(404).json({ error: 'Sale not found.' });
        }

        // v1.0.31 — also surface removed_by_name so the drawer + receipt
        // can render "Removed by <director> on <date>" beneath the
        // struck line.
        const items = await pool.query(
            `SELECT si.*, p.name AS product_name, sv.service_name,
                    ru.full_name AS removed_by_name
       FROM sale_items si
       LEFT JOIN products p ON si.product_id = p.product_id
       LEFT JOIN services sv ON si.service_id = sv.service_id
       LEFT JOIN users   ru ON si.removed_by = ru.user_id
       WHERE si.sale_id = $1`,
            [id]
        );

        // Tender breakdown — populated for every sale (legacy sales were
        // backfilled by migration 023). The frontend renders the per-row
        // breakdown only when length > 1, so single-tender sales look
        // unchanged in the UI.
        const payments = await pool.query(
            `SELECT payment_id, seq, payment_method, amount, payment_reference,
                    tender_type, created_at
             FROM sale_payments
             WHERE sale_id = $1
             ORDER BY seq ASC`,
            [id]
        );

        res.json({ ...sale.rows[0], items: items.rows, payments: payments.rows });
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
    const id = parseIdParam(req, res);
    if (id == null) return;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const sale = await client.query('SELECT * FROM sales WHERE sale_id = $1', [id]);
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
            [id]
        );

        for (const item of items.rows) {
            // Restore stock atomically — increment never blocks.
            await incrementStock(client, item.product_id, item.quantity);
        }

        // Mark sale as voided
        const result = await client.query(
            `UPDATE sales SET is_voided = TRUE, voided_by = $1, voided_at = CURRENT_TIMESTAMP
       WHERE sale_id = $2 RETURNING *`,
            [req.user.user_id, id]
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

        // Fetch the sale via the same enriched query the public PDF endpoint uses
        // so renderReceiptPdf gets every field it expects (customer, staff, items, etc).
        const saleQ = await pool.query(`
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
        `, [sale_id]);

        if (saleQ.rows.length === 0) {
            return res.status(404).json({ error: 'Sale not found.' });
        }
        const sale = saleQ.rows[0];

        const itemsQ = await pool.query(
            `SELECT si.*,
                    COALESCE(p.name, sv.service_name, si.description) AS name,
                    ru.full_name AS removed_by_name
             FROM sale_items si
             LEFT JOIN products p  ON si.product_id = p.product_id
             LEFT JOIN services sv ON si.service_id = sv.service_id
             LEFT JOIN users   ru ON si.removed_by = ru.user_id
             WHERE si.sale_id = $1
             ORDER BY si.item_id`,
            [sale_id]
        );
        sale.items = itemsQ.rows;

        // Tender breakdown — receipt PDF + email surfaces use this when
        // length > 1 (split-tender, v1.0.18). Backfilled rows mean every
        // historical sale has at least one entry.
        const paymentsQ = await pool.query(
            `SELECT seq, payment_method, amount, payment_reference, tender_type
             FROM sale_payments WHERE sale_id = $1 ORDER BY seq`,
            [sale_id]
        );
        sale.payments = paymentsQ.rows;

        // Render the same branded PDFKit receipt the WhatsApp link uses.
        const PDFDocument = require('pdfkit');
        const { renderReceiptPdf, buildPublicReceiptUrl } =
            require('./receiptPdfController');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        const done = new Promise((resolve, reject) => {
            doc.on('end', resolve);
            doc.on('error', reject);
        });
        let pdfBuffer = null;
        let renderErr = null;
        try {
            await renderReceiptPdf(sale, doc);
            doc.end();
            await done;
            pdfBuffer = Buffer.concat(chunks);
        } catch (e) {
            renderErr = e;
            try { doc.end(); } catch (_) { /* doc may already be torn down */ }
            console.error('[emailReceipt] PDF render failed; sending tokenized link fallback:', e);
        }

        const subject = `Receipt ${sale.sale_number || sale.sale_id} - Zachi POS`;
        if (pdfBuffer) {
            await sendEmail(
                email,
                subject,
                `<p>Hello,</p><p>Please find attached your receipt for sale <strong>${sale.sale_number || sale.sale_id}</strong>.</p><p>Thank you for shopping with Zachi Computer Centre.</p>`,
                [
                    {
                        filename: `Receipt-${sale.sale_number || sale.sale_id}.pdf`,
                        content: pdfBuffer,
                    },
                ]
            );
            return res.json({ message: 'Receipt sent successfully.' });
        }

        // Fallback: PDF rendering failed — send the public tokenized link
        // instead so the customer can still download the receipt.
        try {
            const link = buildPublicReceiptUrl(req, sale.sale_id);
            await sendEmail(
                email,
                subject,
                `<p>Hello,</p>` +
                `<p>Your receipt for sale <strong>${sale.sale_number || sale.sale_id}</strong> ` +
                `is ready. Please download it here:</p>` +
                `<p><a href="${link.url}">${link.url}</a></p>` +
                `<p><small>Link expires ${new Date(link.exp * 1000).toUTCString()}.</small></p>` +
                `<p>Thank you for shopping with Zachi Computer Centre.</p>`,
                []
            );
            return res.json({
                message: 'Receipt sent as download link (PDF attachment unavailable).',
                fallback: 'link',
            });
        } catch (linkErr) {
            console.error('[emailReceipt] link fallback also failed:', linkErr);
            return res.status(500).json({
                error: 'Failed to generate receipt PDF: ' +
                    (renderErr && renderErr.message ? renderErr.message : 'unknown error'),
            });
        }
    } catch (err) {
        console.error('Email receipt error:', err);
        res.status(500).json({ error: 'Failed to send email: ' + (err.message || 'unknown error') });
    }
}

/**
 * POST /api/sales/backlog/bulk
 * Bulk-import historical sales from a parsed CSV payload (Director only)
 * Body: { sales: [{ transaction_date, customer_name, payment_method, tax_exempt, notes, items[] }] }
 */
async function createBacklogBulk(req, res) {
    const { sales } = req.body;
    if (!Array.isArray(sales) || sales.length === 0) {
        return res.status(400).json({ error: 'sales array is required.' });
    }

    const results = { inserted: 0, failed: 0, errors: [] };

    for (let i = 0; i < sales.length; i++) {
        const sd = sales[i];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (!sd.payment_method) throw new Error('payment_method is required');
            if (!sd.items || sd.items.length === 0) throw new Error('At least one item is required');

            // Resolve customer by name if provided
            let customerId = null;
            if (sd.customer_name) {
                const cr = await client.query(
                    "SELECT customer_id FROM customers WHERE LOWER(full_name) = LOWER($1) LIMIT 1",
                    [sd.customer_name]
                );
                if (cr.rows.length > 0) customerId = cr.rows[0].customer_id;
            }

            // Build processed items (all custom type for bulk)
            let subtotal = 0;
            const processedItems = [];
            for (const item of sd.items) {
                const unitPrice = parseFloat(item.price_override) || 0;
                // Safely extract cost_price if passed during import
                const costPrice = parseFloat(item.cost_price) || 0;
                const qty = parseFloat(item.quantity) || 1;
                const lineTotal = parseFloat((unitPrice * qty).toFixed(2));
                subtotal += lineTotal;
                processedItems.push({
                    item_type: 'custom',
                    product_id: null,
                    service_id: null,
                    description: item.description || 'Imported Item',
                    quantity: qty,
                    unit_price: unitPrice,
                    cost_price: costPrice,
                    discount: 0,
                    line_total: lineTotal
                });
            }

            const taxRate = sd.tax_exempt ? 0 : 0.16;
            const taxAmount = parseFloat((subtotal * taxRate).toFixed(2));
            const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

            // Sale number using the historical date — minted under
            // an advisory lock so concurrent imports don't collide.
            const saleNumber = await mintSaleNumber(client, sd.transaction_date);

            const saleRes = await client.query(
                `INSERT INTO sales (sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount,
                    total_amount, payment_method, payment_status, amount_paid, change_due, notes,
                    payment_reference, transaction_date)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
                [saleNumber, customerId, req.user.user_id, subtotal, taxAmount, 0,
                    totalAmount, sd.payment_method, 'Paid', totalAmount, 0,
                    sd.notes || null, sd.payment_reference || null,
                    sd.transaction_date || new Date()]
            );
            const sale = saleRes.rows[0];

            for (const item of processedItems) {
                await client.query(
                    `INSERT INTO sale_items (sale_id, item_type, product_id, service_id, description, quantity, unit_price, cost_price, discount, line_total)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                    [sale.sale_id, item.item_type, item.product_id, item.service_id,
                    item.description, item.quantity, item.unit_price, item.cost_price, item.discount, item.line_total]
                );
            }

            // Mirror the new tender into sale_payments so the breakdown
            // UI / reports treat bulk-imported sales the same as
            // freshly-rung-up ones (v1.0.18). Backlog imports are always
            // single-tender — the CSV format has no notion of split
            // payments — so we write exactly one row per sale.
            await client.query(
                `INSERT INTO sale_payments
                    (sale_id, seq, payment_method, amount, payment_reference, tender_type, recorded_by)
                 VALUES ($1, 1, $2, $3, $4, 'sale', $5)`,
                [sale.sale_id, sd.payment_method, totalAmount,
                 sd.payment_reference || null, req.user.user_id]
            );

            await client.query('COMMIT');
            results.inserted++;
        } catch (err) {
            await client.query('ROLLBACK');
            results.failed++;
            results.errors.push({ row: i + 1, error: err.message });
            console.error(`[createBacklogBulk] Row ${i + 1} failed:`, err.message);
        } finally {
            client.release();
        }
    }

    res.json(results);
}

/**
 * GET /api/sales/credit
 * Returns all sales with outstanding balances (payment_status IN ('Credit','Partial'))
 * with credit_payments history and aging in days.
 */
async function getCreditOrders(req, res) {
    try {
        // The aged-balance view powers the Credit Orders module and
        // the new daily reminder cron. We compute three derived
        // fields that the UI / cron lean on:
        //   - balance:        total_amount minus everything captured
        //                     in credit_payments
        //   - days_overdue:   days since the original sale date
        //                     (kept for backwards compatibility with
        //                     the existing Credit Orders age badge)
        //   - days_until_due: positive while still inside the
        //                     payment window, negative once the
        //                     deadline has passed. NULL when the
        //                     sale was created before due_date was
        //                     introduced and somehow missed the
        //                     migration's backfill.
        const result = await pool.query(`
            SELECT
                s.*,
                c.full_name  AS customer_name,
                c.phone      AS customer_phone,
                u.full_name  AS staff_name,
                COALESCE(cp.paid_so_far, 0)                  AS paid_so_far,
                s.total_amount - COALESCE(cp.paid_so_far, 0) AS balance,
                NOW()::date - s.transaction_date::date       AS days_overdue,
                CASE WHEN s.due_date IS NULL THEN NULL
                     ELSE s.due_date - NOW()::date
                END                                          AS days_until_due
            FROM sales s
            LEFT JOIN customers c ON c.customer_id = s.customer_id
            LEFT JOIN users     u ON u.user_id     = s.staff_id
            LEFT JOIN (
                SELECT sale_id, SUM(amount) AS paid_so_far
                FROM credit_payments
                GROUP BY sale_id
            ) cp ON cp.sale_id = s.sale_id
            WHERE s.payment_status IN ('Credit', 'Partial')
              AND s.is_voided = FALSE
            ORDER BY COALESCE(s.due_date, s.transaction_date::date + 30) ASC
        `);
        res.json({ credit_orders: result.rows, total: result.rows.length });
    } catch (err) {
        console.error('[getCreditOrders]', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /api/sales/:id/payment
 * Body: { amount, payment_method, payment_reference, notes }
 * Records an installment payment, updates sales.amount_paid and recalculates payment_status.
 */
async function recordCreditPayment(req, res) {
    const saleId = parseIdParam(req, res);
    if (saleId == null) return;
    const { amount, payment_method = 'Cash', payment_reference, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'A positive amount is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // applyCreditPayment is a guarded UPDATE that returns the new
        // amount_paid + status atomically, so we never overpay (which
        // would corrupt the customer ledger when two installments hit
        // the server at the same moment).
        const updated = await applyCreditPayment(client, saleId, parseFloat(amount));
        const meta = syncMeta(req);

        await client.query(
            `INSERT INTO credit_payments
                (sale_id, amount, payment_method, payment_reference, notes, recorded_by, device_id, client_op_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [saleId, parseFloat(amount), payment_method, payment_reference || null,
                notes || null, req.user.user_id, meta.device_id, meta.client_op_id]
        );

        await client.query('COMMIT');
        res.json({
            message: `Payment of K${parseFloat(amount).toFixed(2)} recorded.`,
            payment_status: updated.payment_status,
            amount_paid: parseFloat(updated.amount_paid),
            total_amount: parseFloat(updated.total_amount),
            balance: parseFloat(updated.total_amount) - parseFloat(updated.amount_paid),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof CreditGuardError) {
            return res.status(409).json({ error: err.message, code: err.code, details: err.details });
        }
        console.error('[recordCreditPayment]', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}

/**
 * DELETE /api/sales/:id
 * Hard-delete a sale (Director only). If the sale was not already voided,
 * stock is restored first. Per-row deletes inside a single transaction so
 * sale_items / sale_payments / cash_movements / credit_payments / loyalty
 * rows go with the parent.
 */
async function deleteSale(req, res) {
    const id = parseIdParam(req, res);
    if (id == null) return;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const sale = await client.query('SELECT * FROM sales WHERE sale_id = $1', [id]);
        if (sale.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Sale not found.' });
        }

        // Restore stock only if the sale was still live (not already voided).
        if (!sale.rows[0].is_voided) {
            const items = await client.query(
                "SELECT product_id, quantity FROM sale_items WHERE sale_id = $1 AND item_type = 'product' AND product_id IS NOT NULL",
                [id]
            );
            for (const item of items.rows) {
                await incrementStock(client, item.product_id, item.quantity);
            }
        }

        // Detach dependent rows that don't have ON DELETE CASCADE wired.
        // Best-effort: ignore "relation does not exist" so older databases
        // missing optional tables (e.g. sale_payments before v1.0.18) don't
        // break the delete.
        const safeDeletes = [
            "DELETE FROM sale_items WHERE sale_id = $1",
            "DELETE FROM sale_payments WHERE sale_id = $1",
            "DELETE FROM cash_movements WHERE source_table = 'sales' AND source_id = $1",
            "DELETE FROM credit_payments WHERE sale_id = $1",
            "DELETE FROM loyalty_transactions WHERE sale_id = $1",
        ];
        for (const sql of safeDeletes) {
            try { await client.query(sql, [id]); }
            catch (e) { if (!/does not exist/i.test(e.message)) throw e; }
        }

        await client.query('DELETE FROM sales WHERE sale_id = $1', [id]);
        await client.query('COMMIT');
        res.json({ message: 'Sale deleted.', sale_id: id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete sale error:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    } finally {
        client.release();
    }
}

/**
 * GET /api/sales/lookup?sale_number=S-000123
 *
 * Resolve a sale_number (or partial — exact match first, then prefix)
 * to a sale_id so the Daily Sales screen can jump to any historical
 * sale regardless of the current date filter or paging window. Returns
 * 404 if nothing matches; 200 `{sale_id, sale_number}` on a unique
 * match; 200 `{matches: [...]}` with up to 10 candidates on an
 * ambiguous prefix so the UI can prompt for disambiguation.
 */
async function lookupSale(req, res) {
    try {
        const raw = String(req.query.sale_number || '').trim();
        if (!raw) return res.status(400).json({ error: 'sale_number is required.' });

        // Exact match first.
        const exact = await pool.query(
            'SELECT sale_id, sale_number FROM sales WHERE sale_number = $1 LIMIT 1',
            [raw]
        );
        if (exact.rows.length === 1) return res.json(exact.rows[0]);

        // Then prefix / contains, case-insensitive. Cap at 10 so we
        // never spray a huge list back at the UI.
        const fuzzy = await pool.query(
            `SELECT sale_id, sale_number, transaction_date, total_amount
               FROM sales
              WHERE sale_number ILIKE $1
              ORDER BY transaction_date DESC
              LIMIT 10`,
            [`%${raw}%`]
        );

        if (fuzzy.rows.length === 0) {
            return res.status(404).json({ error: 'No sale found with that number.' });
        }
        if (fuzzy.rows.length === 1) return res.json(fuzzy.rows[0]);
        res.json({ matches: fuzzy.rows });
    } catch (err) {
        console.error('Sale lookup error:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    }
}

/**
 * DELETE /api/sales/:id/items/:itemId
 *
 * v1.0.31 (Task #57) — Per-line refund. Director-only. Soft-marks
 * one sale_items row as removed_at = NOW(), restores its stock,
 * recomputes the sale's subtotal/tax/total, shrinks the largest
 * sale_payments tender by the removed gross (cascading if needed),
 * posts a negative cash_movements row for any cash leg shrunk, and
 * appends an audit_logs entry. Returns the refreshed sale in the
 * same shape as getSale so the UI can re-render the drawer in one
 * round-trip.
 *
 * Refuses if:
 *   - sale or item not found (404)
 *   - sale is voided / deleted (409)
 *   - item is already removed (409)
 *   - the item is the last surviving line on the sale (409 — force
 *     the director to Delete the whole sale instead so we never end
 *     up with a zero-line "ghost" sale)
 */
async function removeSaleItem(req, res) {
    const id = parseIdParam(req, res);
    if (id == null) return;
    const itemId = parseIdParam(req, res, 'itemId');
    if (itemId == null) return;
    const reason = (req.body && typeof req.body.reason === 'string')
        ? req.body.reason.trim().slice(0, 500) || null
        : null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const saleQ = await client.query(
            'SELECT * FROM sales WHERE sale_id = $1 FOR UPDATE',
            [id]
        );
        if (saleQ.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Sale not found.' });
        }
        const sale = saleQ.rows[0];
        // The sales table has no soft-delete column (deleteSale is a
        // hard DELETE — see migrations 001 / 023). A hard-deleted sale
        // therefore cannot reach this point; the FOR UPDATE select
        // above already returned 404 for it. We still guard against
        // is_deleted defensively in case a future migration adds it,
        // so the endpoint stays correct without another code change.
        if (sale.is_voided || sale.is_deleted) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Sale is voided or deleted — use Reverse / Delete instead of removing a line.' });
        }

        const itemQ = await client.query(
            'SELECT * FROM sale_items WHERE item_id = $1 AND sale_id = $2 FOR UPDATE',
            [itemId, id]
        );
        if (itemQ.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Sale item not found on this sale.' });
        }
        const item = itemQ.rows[0];
        if (item.removed_at) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'This line was already removed.' });
        }

        // Refuse to remove the last surviving line — that would leave
        // a zero-item sale. The director should Delete the whole sale.
        const survivingQ = await client.query(
            'SELECT COUNT(*)::int AS n FROM sale_items WHERE sale_id = $1 AND removed_at IS NULL',
            [id]
        );
        if (survivingQ.rows[0].n <= 1) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Cannot remove the last remaining line. Delete the whole sale instead.',
            });
        }

        // 1. Restore stock for product lines (services don't touch stock).
        if (item.item_type === 'product' && item.product_id) {
            await incrementStock(client, item.product_id, Number(item.quantity));
            // Inventory ledger entry — mirror the columns voidSale would
            // use if it wrote one. Best-effort: ignore "relation does
            // not exist" for installs that never ran 004a.
            try {
                await client.query(
                    `INSERT INTO inventory_movements
                        (product_id, movement_type, quantity, reference_type,
                         reference_id, reason, performed_by)
                     VALUES ($1, 'sale_line_removed', $2, 'sale', $3, $4, $5)`,
                    [item.product_id, Number(item.quantity), id,
                     `Sale ${sale.sale_number} line removed: ${reason || 'no reason given'}`,
                     req.user.user_id]
                );
            } catch (e) {
                if (!/does not exist/i.test(e.message)) throw e;
            }
        }

        // 2. Soft-mark the line as removed.
        await client.query(
            `UPDATE sale_items
                SET removed_at = NOW(),
                    removed_by = $1,
                    removed_reason = $2
              WHERE item_id = $3`,
            [req.user.user_id, reason, itemId]
        );

        // 3. Recompute sale totals from the surviving lines. We keep the
        // existing tax_amount / discount_amount ratios proportional so a
        // tax-exempt sale stays tax-exempt and a discounted sale keeps
        // its discount percentage. Subtotal is authoritative — it sums
        // line_total of surviving rows.
        const totalsQ = await client.query(
            `SELECT COALESCE(SUM(line_total), 0)::numeric(12,2) AS new_subtotal
               FROM sale_items
              WHERE sale_id = $1 AND removed_at IS NULL`,
            [id]
        );
        const newSubtotal = Number(totalsQ.rows[0].new_subtotal);
        const oldSubtotal = Number(sale.subtotal || 0) || 1; // guard div-by-zero
        const ratio = newSubtotal / oldSubtotal;
        const newDiscount = Math.round(Number(sale.discount_amount || 0) * ratio * 100) / 100;
        const newTax      = Math.round(Number(sale.tax_amount || 0)      * ratio * 100) / 100;
        const newTotal    = Math.round((newSubtotal - newDiscount + newTax) * 100) / 100;
        const oldTotal    = Number(sale.total_amount || 0);
        const oldPaid     = Number(sale.amount_paid  || 0);
        // ARCHITECT FIX v2 (P1): the refund is the actual OVERPAYMENT
        // after recompute, not the total drop. Example: old total 100
        // paid 60 on credit; remove a 40 line so new total = 60. No
        // refund is due — they just no longer owe anything. The earlier
        // (oldTotal - newTotal) formula would have refunded the full
        // 40 in that case, corrupting amount_paid and the till.
        // For fully-paid sales this collapses to (oldTotal - newTotal)
        // because oldPaid == oldTotal.
        const refundDelta = Math.max(0, Math.round((oldPaid - newTotal) * 100) / 100);

        // Hold sales.amount_paid update until after the tender shrink so
        // we can set it from the actual post-shrink tender sum (single
        // source of truth) rather than the LEAST() guess.
        await client.query(
            `UPDATE sales
                SET subtotal = $1,
                    discount_amount = $2,
                    tax_amount = $3,
                    total_amount = $4,
                    updated_at = CURRENT_TIMESTAMP
              WHERE sale_id = $5`,
            [newSubtotal, newDiscount, newTax, newTotal, id]
        );

        // 4. Tender reconciliation. Shrink the largest tender first,
        // cascading down. If the shrunk tender is cash, post a negative
        // cash_movements row so the EOD float reconciles. Mobile-money
        // / bank tenders just shrink in sale_payments — no till impact.
        const paysQ = await client.query(
            `SELECT * FROM sale_payments
              WHERE sale_id = $1 AND tender_type = 'sale'
              ORDER BY amount DESC, seq ASC`,
            [id]
        );
        let toRefund = refundDelta;
        for (const p of paysQ.rows) {
            if (toRefund <= 0.005) break;
            const cur = Number(p.amount);
            if (cur <= 0) continue;
            const take = Math.min(cur, toRefund);
            const newAmt = Math.round((cur - take) * 100) / 100;
            await client.query(
                'UPDATE sale_payments SET amount = $1 WHERE payment_id = $2',
                [newAmt, p.payment_id]
            );
            toRefund -= take;

            // Cash leg → negative till movement so the cashier sees it
            // when reconciling. Other tenders leave no till trace.
            if (String(p.payment_method).toLowerCase() === 'cash' && take > 0) {
                try {
                    const openSession = await client.query(
                        "SELECT session_id FROM cash_sessions WHERE status = 'Open' ORDER BY opened_at DESC LIMIT 1"
                    );
                    if (openSession.rows.length > 0) {
                        await client.query(
                            `INSERT INTO cash_movements
                                (session_id, movement_type, amount, description,
                                 reference_type, reference_id, performed_by)
                             VALUES ($1, 'sale_line_refund', $2, $3, 'sale', $4, $5)`,
                            [openSession.rows[0].session_id,
                             (-take).toFixed(2),
                             `Line removed from sale ${sale.sale_number}: ${reason || 'no reason given'}`,
                             id, req.user.user_id]
                        );
                    }
                } catch (e) {
                    if (!/does not exist/i.test(e.message)) throw e;
                }
            }
        }

        // 4b. ARCHITECT FIX (P1): reconcile sales.amount_paid from the
        // actual post-shrink tender sum so the invariant
        //   amount_paid == SUM(sale_payments WHERE tender_type='sale')
        // always holds, then recompute payment_status + change_due
        // from the final (total_amount, amount_paid) pair. Without
        // this a Partial sale that becomes fully covered by the
        // removal (e.g. total 100 paid 60, remove a 40 line) would
        // still show as Partial and clutter Credit Orders.
        const paidQ = await client.query(
            `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS paid
               FROM sale_payments
              WHERE sale_id = $1 AND tender_type = 'sale'`,
            [id]
        );
        const finalPaid = Number(paidQ.rows[0].paid);
        const finalChange = Math.max(0, Math.round((finalPaid - newTotal) * 100) / 100);
        let newStatus;
        if (finalPaid >= newTotal - 0.005)      newStatus = 'Paid';
        else if (finalPaid > 0.005)             newStatus = 'Partial';
        else                                    newStatus = 'Credit';
        await client.query(
            `UPDATE sales
                SET amount_paid    = $1,
                    change_due     = $2,
                    payment_status = $3
              WHERE sale_id = $4`,
            [finalPaid, finalChange, newStatus, id]
        );

        // 5. Audit log row — same table as voidSale uses.
        try {
            await client.query(
                `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value)
                 VALUES ($1, 'REMOVE_SALE_ITEM', 'sale_items', $2, $3, $4)`,
                [req.user.user_id, itemId,
                 JSON.stringify({ sale_id: id, sale_number: sale.sale_number,
                                  description: item.description, quantity: item.quantity,
                                  line_total: item.line_total }),
                 JSON.stringify({ removed_reason: reason })]
            );
        } catch (e) {
            if (!/does not exist/i.test(e.message)) throw e;
        }

        await client.query('COMMIT');

        // Reload + return the refreshed sale (same shape as getSale) so
        // the drawer can re-render in one round trip.
        const fresh   = await pool.query('SELECT s.*, u.full_name AS staff_name, c.full_name AS customer_name FROM sales s LEFT JOIN users u ON s.staff_id = u.user_id LEFT JOIN customers c ON s.customer_id = c.customer_id WHERE s.sale_id = $1', [id]);
        const freshIt = await pool.query(`SELECT si.*, p.name AS product_name, sv.service_name, ru.full_name AS removed_by_name
                                            FROM sale_items si
                                            LEFT JOIN products p  ON si.product_id  = p.product_id
                                            LEFT JOIN services sv ON si.service_id = sv.service_id
                                            LEFT JOIN users   ru ON si.removed_by  = ru.user_id
                                           WHERE si.sale_id = $1`, [id]);
        const freshPay = await pool.query(`SELECT payment_id, seq, payment_method, amount, payment_reference, tender_type, created_at
                                             FROM sale_payments WHERE sale_id = $1 ORDER BY seq ASC`, [id]);
        res.json({ ...fresh.rows[0], items: freshIt.rows, payments: freshPay.rows });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        console.error('removeSaleItem error:', err);
        res.status(500).json({ error: err.message || 'Server error.' });
    } finally {
        client.release();
    }
}

module.exports = { createSale, listSales, getSale, voidSale, deleteSale, lookupSale, removeSaleItem, emailReceipt, createBacklogBulk, getCreditOrders, recordCreditPayment };
