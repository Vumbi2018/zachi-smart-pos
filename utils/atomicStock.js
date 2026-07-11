/**
 * Atomic stock + balance helpers.
 *
 * Why these exist
 * ---------------
 * The pre-sync code did:
 *   UPDATE products SET stock_quantity = stock_quantity - $1 WHERE product_id = $2
 *
 * That works fine when one cashier processes one sale at a time, but
 * the moment two offline tablets reconnect with overlapping carts the
 * race lets them both succeed and oversells the last unit.
 *
 * The helpers below all use a guarded UPDATE with RETURNING so that
 *   (a) the decrement only happens when the resource is sufficient,
 *   (b) we get the new balance back in the same round-trip,
 *   (c) the caller can throw a typed error that the sync engine maps
 *       to a `failed_ops` entry in IndexedDB and a banner for the
 *       cashier — instead of a silent oversell.
 */

class StockGuardError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'StockGuardError';
        this.code = 'INSUFFICIENT_STOCK';
        this.details = details || {};
    }
}

class LoyaltyGuardError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'LoyaltyGuardError';
        this.code = 'INSUFFICIENT_POINTS';
        this.details = details || {};
    }
}

class CreditGuardError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'CreditGuardError';
        this.code = 'OVERPAYMENT';
        this.details = details || {};
    }
}

/**
 * Atomically decrement product stock.
 * Throws StockGuardError if the requested quantity exceeds availability.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} productId
 * @param {number} quantity   — positive integer
 * @returns {Promise<{stock_quantity: number, name: string}>} new balance + product name
 */
async function decrementStock(client, productId, quantity) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new StockGuardError('Quantity must be a positive number.', { productId, quantity });
    }
    const r = await client.query(
        `UPDATE products
            SET stock_quantity = stock_quantity - $1::numeric::int,
                updated_at     = CURRENT_TIMESTAMP
          WHERE product_id = $2
            AND stock_quantity >= $1::numeric::int
        RETURNING stock_quantity, name`,
        [quantity, productId]
    );
    if (r.rows.length === 0) {
        // Find out *why* it failed so the message can be helpful.
        const probe = await client.query(
            'SELECT name, stock_quantity FROM products WHERE product_id = $1',
            [productId]
        );
        if (probe.rows.length === 0) {
            throw new StockGuardError(`Product ${productId} not found.`, { productId });
        }
        throw new StockGuardError(
            `Insufficient stock for "${probe.rows[0].name}". Available: ${probe.rows[0].stock_quantity}, requested: ${quantity}.`,
            {
                productId,
                productName: probe.rows[0].name,
                available: Number(probe.rows[0].stock_quantity),
                requested: quantity,
            }
        );
    }
    return r.rows[0];
}

/**
 * Atomically restore stock (used by void/return paths).
 */
async function incrementStock(client, productId, quantity) {
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    await client.query(
        `UPDATE products
            SET stock_quantity = stock_quantity + $1::numeric::int,
                updated_at     = CURRENT_TIMESTAMP
          WHERE product_id = $2`,
        [quantity, productId]
    );
}

/**
 * Atomically redeem loyalty points.
 * Throws LoyaltyGuardError if the customer doesn't have enough points.
 */
async function redeemLoyaltyPoints(client, customerId, points) {
    if (!Number.isFinite(points) || points <= 0) {
        throw new LoyaltyGuardError('Points to redeem must be positive.', { customerId, points });
    }
    const r = await client.query(
        `UPDATE customers
            SET loyalty_points = loyalty_points - $1
          WHERE customer_id = $2
            AND loyalty_points >= $1
        RETURNING loyalty_points`,
        [points, customerId]
    );
    if (r.rows.length === 0) {
        const probe = await client.query(
            'SELECT loyalty_points FROM customers WHERE customer_id = $1',
            [customerId]
        );
        if (probe.rows.length === 0) {
            throw new LoyaltyGuardError(`Customer ${customerId} not found.`, { customerId });
        }
        throw new LoyaltyGuardError(
            `Insufficient loyalty points. Balance: ${probe.rows[0].loyalty_points}, requested: ${points}.`,
            { customerId, available: Number(probe.rows[0].loyalty_points), requested: points }
        );
    }
    return Number(r.rows[0].loyalty_points);
}

/**
 * Atomically credit loyalty points (always succeeds — used at sale time).
 */
async function earnLoyaltyPoints(client, customerId, points) {
    if (!Number.isFinite(points) || points <= 0) return;
    await client.query(
        `UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE customer_id = $2`,
        [points, customerId]
    );
}

/**
 * Atomically apply a credit-order payment.
 *
 * Hard-guarded against overpayment: we refuse the UPDATE if the new
 * `amount_paid` would exceed `total_amount`, instead of silently
 * capping the increment. Capping with LEAST() would leave the
 * `credit_payments.amount` row out of sync with the actual change to
 * `sales.amount_paid` (e.g. cashier types K200 against a K30 balance →
 * ledger says K200 paid, sale only moved K30 → ghost K170 floats in
 * the books). Returning OVERPAYMENT lets the cashier correct the
 * amount or apply the surplus elsewhere.
 */
async function applyCreditPayment(client, saleId, amount) {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new CreditGuardError('Amount must be positive.', { saleId, amount });
    }
    const r = await client.query(
        `UPDATE sales
            SET amount_paid    = amount_paid + $1,
                payment_status = CASE
                    WHEN amount_paid + $1 >= total_amount THEN 'Paid'
                    WHEN amount_paid + $1 > 0             THEN 'Partial'
                    ELSE 'Credit'
                END
          WHERE sale_id   = $2
            AND is_voided = FALSE
            AND amount_paid + $1 <= total_amount
        RETURNING amount_paid, payment_status, total_amount`,
        [amount, saleId]
    );
    if (r.rows.length === 0) {
        // Distinguish "not found" from "overpayment".
        const probe = await client.query(
            `SELECT total_amount, amount_paid, is_voided
               FROM sales WHERE sale_id = $1`,
            [saleId]
        );
        if (probe.rows.length === 0) {
            throw new CreditGuardError(`Sale ${saleId} not found.`, { saleId });
        }
        const row = probe.rows[0];
        if (row.is_voided) {
            throw new CreditGuardError(`Sale ${saleId} is voided.`, { saleId });
        }
        const remaining = Number(row.total_amount) - Number(row.amount_paid);
        throw new CreditGuardError(
            `Payment of ${amount} exceeds remaining balance ${remaining.toFixed(2)} on sale ${saleId}.`,
            {
                saleId,
                requested: amount,
                remaining,
                totalAmount: Number(row.total_amount),
                amountPaid: Number(row.amount_paid),
            }
        );
    }
    return r.rows[0];
}

module.exports = {
    decrementStock,
    incrementStock,
    redeemLoyaltyPoints,
    earnLoyaltyPoints,
    applyCreditPayment,
    StockGuardError,
    LoyaltyGuardError,
    CreditGuardError,
};
