/**
 * Sale-number minting helper.
 *
 * Mints a unique `ZC-YYYYMMDD-NNN` sale number per (transaction_date)
 * day, holding a Postgres advisory lock keyed by that date so that two
 * concurrent sync requests from different devices cannot both pick up
 * the same sequence number.
 *
 * The advisory lock is released when the transaction commits/rolls back.
 *
 * Usage (must be called inside a BEGIN/COMMIT block on the same client):
 *   const number = await mintSaleNumber(client, transactionDate);
 */

const PREFIX = 'ZC';

function dateToYYYYMMDD(d) {
    const date = d ? new Date(d) : new Date();
    return (
        date.getFullYear().toString() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0')
    );
}

/**
 * Hash a string into a stable signed 32-bit integer for pg_advisory_xact_lock(int).
 * Postgres advisory_lock takes either a single bigint or two ints; we
 * keep it simple with one bigint built from a fnv-1a 32-bit hash of
 * the date string + a constant tag for the "sale-number" lock domain.
 */
function lockKeyForDate(dateStr) {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    const tag = `salenumber:${dateStr}`;
    for (let i = 0; i < tag.length; i++) {
        h ^= tag.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    // Postgres bigint is 64-bit signed. Spread the 32-bit hash into the
    // lower 32 bits and a fixed 16-bit "domain" tag in the upper bits so
    // the sale-number domain never collides with future advisory-lock
    // users (e.g. a future stock-batch domain).
    const DOMAIN = 0x5300; // arbitrary "S" tag for sales
    // Build as Number; values stay well within JS safe-integer range.
    return DOMAIN * 2 ** 32 + h;
}

/**
 * @param {import('pg').PoolClient} client - already inside BEGIN
 * @param {Date|string} [transactionDate] - optional historical date
 * @returns {Promise<string>} e.g. "ZC-20260424-007"
 */
async function mintSaleNumber(client, transactionDate) {
    const dateStr = dateToYYYYMMDD(transactionDate);
    const prefix = `${PREFIX}-${dateStr}`;
    const lockKey = lockKeyForDate(dateStr);

    // Transaction-scoped advisory lock — released automatically on commit/rollback.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    const last = await client.query(
        `SELECT sale_number
           FROM sales
          WHERE sale_number LIKE $1
          ORDER BY sale_number DESC
          LIMIT 1`,
        [`${prefix}-%`]
    );

    let next = 1;
    if (last.rows.length > 0) {
        const parts = last.rows[0].sale_number.split('-');
        if (parts.length === 3) {
            const parsed = parseInt(parts[2], 10);
            if (Number.isInteger(parsed) && parsed > 0) next = parsed + 1;
        }
    }
    return `${prefix}-${String(next).padStart(3, '0')}`;
}

module.exports = { mintSaleNumber, dateToYYYYMMDD, lockKeyForDate, PREFIX };
