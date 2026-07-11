#!/usr/bin/env node
/**
 * scripts/cleanup-idempotency.js
 *
 * Cron-friendly purge of expired `idempotency_keys` rows. The contract
 * documented in SYNC.md is that an `Idempotency-Key` is honoured for
 * **30 days** after first use; after that, retries are treated as
 * fresh requests. Production should run this nightly:
 *
 *   30 02 * * *   node /app/scripts/cleanup-idempotency.js >> /var/log/zachi-pos/cleanup.log 2>&1
 *
 * Without a cron, the same DELETE runs lazily on every /api/sync/push
 * (rate-limited to once per hour per process inside syncController).
 *
 * Exits 0 on success, 1 on any error so cron alerting picks it up.
 */

const pool = require('../db/pool');

const RETENTION_DAYS = parseInt(process.env.IDEMPOTENCY_RETENTION_DAYS || '30', 10);

async function main() {
    const t0 = Date.now();
    const r = await pool.query(
        `DELETE FROM idempotency_keys
          WHERE created_at < NOW() - ($1 || ' days')::interval
        RETURNING key`,
        [String(RETENTION_DAYS)]
    );
    const ms = Date.now() - t0;
    console.log(
        `[cleanup-idempotency] removed ${r.rowCount} key(s) older than ${RETENTION_DAYS} day(s) in ${ms} ms`
    );
}

main()
    .then(() => pool.end().then(() => process.exit(0)))
    .catch((err) => {
        console.error('[cleanup-idempotency] failed:', err);
        pool.end().finally(() => process.exit(1));
    });
