/**
 * Zachi Smart-POS — Background Job Scheduler
 *
 * Hosts all node-cron tasks in one place so the boot path can disable
 * them with a single env flag (DISABLE_CRON=true) — useful for tests
 * and short-lived migration runs.
 *
 * Currently scheduled:
 *   - Hourly low-stock alert        (top of every hour, minute 5)
 *   - Daily credit-debt reminder    (08:30 server time)
 *   - Nightly DB backup → /backups  (02:00 server time, retains 30 days)
 *
 * All tasks are wrapped in try/catch so one failure can never crash the
 * server.
 */
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pool = require('../db/pool');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = 30;

let started = false;

function safeRun(name, fn) {
    return async () => {
        const t0 = Date.now();
        try {
            await fn();
            console.log(`[cron] ${name} ok in ${Date.now() - t0}ms`);
        } catch (err) {
            console.error(`[cron] ${name} FAILED:`, err.message);
        }
    };
}

// Returns [{email, name}] for scheduled-job emails: active directors
// with an email, merged with notifications.recipients, de-duped by email.
async function getNotificationRecipients() {
    const recipients = [];
    const seen = new Set();

    const pushOne = (email, name) => {
        const e = (email || '').trim();
        if (!e) return;
        const key = e.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        recipients.push({ email: e, name: (name || 'Director').toString() });
    };

    try {
        const directors = await pool.query(
            `SELECT email, full_name FROM users
              WHERE role = 'director' AND is_active = TRUE AND email IS NOT NULL AND email <> ''`
        );
        for (const d of directors.rows) pushOne(d.email, d.full_name);
    } catch (e) {
        console.error('[cron] getNotificationRecipients: directors lookup failed:', e.message);
    }

    try {
        const r = await pool.query(
            `SELECT setting_value FROM system_settings WHERE setting_key = 'notifications.recipients'`
        );
        if (r.rows.length > 0) {
            // setting_value is JSONB — node-pg gives us a parsed value already.
            const raw = r.rows[0].setting_value;
            const list = Array.isArray(raw) ? raw : [];
            for (const item of list) {
                if (!item) continue;
                if (typeof item === 'string') pushOne(item, '');
                else pushOne(item.email, item.name);
            }
        }
    } catch (e) {
        console.error('[cron] getNotificationRecipients: settings lookup failed:', e.message);
    }

    return recipients;
}

// Returns [{phone, name}] from notifications.whatsapp_recipients.
async function getWhatsappRecipients() {
    try {
        const r = await pool.query(
            `SELECT setting_value FROM system_settings WHERE setting_key = 'notifications.whatsapp_recipients'`
        );
        if (r.rows.length === 0) return [];
        const raw = r.rows[0].setting_value;
        const list = Array.isArray(raw) ? raw : [];
        const out = [];
        const seen = new Set();
        for (const item of list) {
            if (!item) continue;
            const phone = String(item.phone || '').trim();
            if (!/^\+[1-9]\d{7,14}$/.test(phone)) continue;
            if (seen.has(phone)) continue;
            seen.add(phone);
            out.push({ phone, name: String(item.name || '').trim() });
        }
        return out;
    } catch (e) {
        console.error('[cron] getWhatsappRecipients failed:', e.message);
        return [];
    }
}

// WhatsApp dispatch. Now delegates to services/messaging.js which reads
// provider config from system_settings (admin-configurable) with fallback
// to env vars (WHATSAPP_PROVIDER / WHATSAPP_WEBHOOK_URL / WHATSAPP_WEBHOOK_TOKEN).
// Sends are issued in parallel with a per-recipient timeout so one slow
// gateway response doesn't block the cron tick.
async function sendWhatsappAlert(subject, body) {
    const recipients = await getWhatsappRecipients();
    if (recipients.length === 0) return;
    let messaging;
    try { messaging = require('../services/messaging'); }
    catch (e) {
        console.error('[cron] WhatsApp dispatch unavailable:', e.message);
        return;
    }
    try {
        const status = await messaging.getStatus();
        if (!status.whatsapp.configured) {
            console.warn(
                `[cron] WhatsApp gateway not configured (Settings → SMS & WhatsApp Gateway, ` +
                `or env WHATSAPP_PROVIDER/WHATSAPP_WEBHOOK_URL). ` +
                `Skipping ${recipients.length} recipient(s) for "${subject}".`
            );
            return;
        }
        const results = await messaging.sendBulk('whatsapp', recipients, { subject, body });
        const ok = results.filter((r) => r.ok).length;
        const failed = results.length - ok;
        if (failed > 0) {
            const reasons = results.filter((r) => !r.ok).map((r) => r.reason).slice(0, 5).join(',');
            console.error(
                `[cron] WhatsApp "${subject}": ${ok}/${results.length} sent, ` +
                `${failed} failed (${reasons}).`
            );
        } else {
            console.log(`[cron] WhatsApp "${subject}": ${ok}/${results.length} sent.`);
        }
    } catch (e) {
        console.error(`[cron] WhatsApp dispatch failed for "${subject}":`, e.message || e);
    }
}

// =====================================================
// Low-stock alert — hourly
// =====================================================
async function lowStockAlert() {
    const { rows } = await pool.query(`
        SELECT product_id, name, sku, stock_quantity, reorder_level
        FROM products
        WHERE is_active = TRUE
          AND reorder_level > 0
          AND stock_quantity <= reorder_level
        ORDER BY (stock_quantity::float / NULLIF(reorder_level,0)) ASC, name ASC
        LIMIT 200
    `);
    if (rows.length === 0) return;

    // Find directors to notify (in-app notification + email)
    const directors = await pool.query(
        `SELECT user_id, email, full_name FROM users WHERE role = 'director' AND is_active = TRUE`
    );
    if (directors.rows.length === 0) return;

    // Group into a single notification per director (don't spam)
    const summary =
        rows.length === 1
            ? `Low stock: ${rows[0].name} has ${rows[0].stock_quantity} left (reorder level ${rows[0].reorder_level}).`
            : `${rows.length} products are at or below their reorder level. Top items: ${rows
                  .slice(0, 5)
                  .map((r) => `${r.name} (${r.stock_quantity})`)
                  .join(', ')}.`;

    for (const dir of directors.rows) {
        try {
            await pool.query(
                `INSERT INTO notifications (user_id, type, message, related_id) VALUES ($1, $2, $3, $4)`,
                [dir.user_id, 'low_stock', summary, null]
            );
        } catch (e) {
            // notifications table may not have related_id nullable everywhere — fall back without it
            try {
                await pool.query(
                    `INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)`,
                    [dir.user_id, 'low_stock', summary]
                );
            } catch (_) { /* ignore */ }
        }
    }

    // Send one consolidated email per director
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        const { sendEmail } = require('../utils/email');
        const html =
            `<p>Hi {{name}},</p>` +
            `<p>${summary}</p>` +
            `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;">` +
            `<thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Reorder Level</th></tr></thead><tbody>` +
            rows
                .slice(0, 50)
                .map(
                    (r) =>
                        `<tr><td>${r.name}</td><td>${r.sku || ''}</td><td style="text-align:right">${r.stock_quantity}</td><td style="text-align:right">${r.reorder_level}</td></tr>`
                )
                .join('') +
            `</tbody></table>` +
            `<p style="margin-top:1rem;">— Zachi Smart-POS</p>`;

        // Send to the configured recipient list (active directors +
        // any extras from system_settings → notifications.recipients).
        const recipients = await getNotificationRecipients();
        for (const r of recipients) {
            try {
                await sendEmail(
                    r.email,
                    `Low-stock alert — ${rows.length} item${rows.length === 1 ? '' : 's'}`,
                    html.replace('{{name}}', r.name || 'Director')
                );
            } catch (e) {
                console.error('[cron] low-stock email to', r.email, 'failed:', e.message);
            }
        }
    }

    // WhatsApp fan-out (logs only when no provider configured).
    try {
        await sendWhatsappAlert(
            `Low-stock alert — ${rows.length} item${rows.length === 1 ? '' : 's'}`,
            summary
        );
    } catch (e) {
        console.error('[cron] low-stock whatsapp fan-out failed:', e.message);
    }
}

// =====================================================
// Daily credit-debt reminder — 08:30 server time
// =====================================================
//
// Surfaces every outstanding Credit / Partial sale that is either
// already overdue OR coming due in the next 7 days, and emails the
// summary to every active director. We also stamp
// `last_reminder_sent_at` on each sale so the dashboard can show
// "last nudged on …" — and so a future enhancement can avoid
// re-emailing the customer themselves more than once a week.
async function creditReminders() {
    const { rows } = await pool.query(`
        SELECT
            s.sale_id,
            s.sale_number,
            s.transaction_date,
            s.due_date,
            s.total_amount,
            s.payment_status,
            COALESCE(cp.paid_so_far, 0) AS paid_so_far,
            (s.total_amount - COALESCE(cp.paid_so_far, 0)) AS balance,
            (s.due_date - NOW()::date) AS days_until_due,
            c.full_name AS customer_name,
            c.phone     AS customer_phone,
            c.email     AS customer_email
        FROM sales s
        LEFT JOIN customers c ON c.customer_id = s.customer_id
        LEFT JOIN (
            SELECT sale_id, SUM(amount) AS paid_so_far
            FROM credit_payments
            GROUP BY sale_id
        ) cp ON cp.sale_id = s.sale_id
        WHERE s.payment_status IN ('Credit', 'Partial')
          AND s.is_voided = FALSE
          AND s.due_date IS NOT NULL
          AND s.due_date <= NOW()::date + INTERVAL '7 days'
          AND (s.total_amount - COALESCE(cp.paid_so_far, 0)) > 0
          -- Idempotency guard: skip rows we already reminded about
          -- in the last 20 hours so a server restart shortly after
          -- 08:30 cannot double-send the morning digest.
          AND (s.last_reminder_sent_at IS NULL
               OR s.last_reminder_sent_at < NOW() - INTERVAL '20 hours')
        ORDER BY s.due_date ASC, s.sale_id ASC
    `);

    if (rows.length === 0) return;

    // Find directors to notify (in-app + email) — same pattern as
    // the low-stock alert above so the operations team only has one
    // mental model for "who gets the morning emails."
    const directors = await pool.query(
        `SELECT user_id, email, full_name FROM users WHERE role = 'director' AND is_active = TRUE`
    );
    if (directors.rows.length === 0) return;

    const overdue = rows.filter((r) => parseInt(r.days_until_due, 10) < 0);
    const dueSoon = rows.filter((r) => parseInt(r.days_until_due, 10) >= 0);

    const totalOutstanding = rows.reduce((s, r) => s + parseFloat(r.balance || 0), 0);
    const overdueAmt       = overdue.reduce((s, r) => s + parseFloat(r.balance || 0), 0);

    const summary =
        `${rows.length} credit balance${rows.length === 1 ? '' : 's'} need attention — ` +
        `${overdue.length} overdue (K${overdueAmt.toFixed(2)}), ${dueSoon.length} due within 7 days. ` +
        `Total outstanding: K${totalOutstanding.toFixed(2)}.`;

    // In-app notifications
    for (const dir of directors.rows) {
        try {
            await pool.query(
                `INSERT INTO notifications (user_id, type, message, related_id) VALUES ($1, $2, $3, $4)`,
                [dir.user_id, 'credit_reminder', summary, null]
            );
        } catch (e) {
            try {
                await pool.query(
                    `INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)`,
                    [dir.user_id, 'credit_reminder', summary]
                );
            } catch (_) { /* ignore */ }
        }
    }

    // Email digest
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        const { sendEmail } = require('../utils/email');

        const rowHtml = (r) => {
            const d = parseInt(r.days_until_due, 10);
            const status = d < 0
                ? `<span style="color:#b91c1c;font-weight:600;">${Math.abs(d)}d overdue</span>`
                : `<span style="color:#a16207;">due in ${d}d</span>`;
            const due = r.due_date ? new Date(r.due_date).toLocaleDateString() : '';
            return `<tr>
                <td>${r.sale_number || ''}</td>
                <td>${r.customer_name || 'Walk-in'}</td>
                <td>${r.customer_phone || ''}</td>
                <td style="text-align:right;">K ${parseFloat(r.balance || 0).toFixed(2)}</td>
                <td>${due}</td>
                <td>${status}</td>
            </tr>`;
        };

        const html =
            `<p>Hi {{name}},</p>` +
            `<p>${summary}</p>` +
            `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px;">` +
            `<thead style="background:#f1f5f9;"><tr>` +
            `<th>Sale #</th><th>Customer</th><th>Phone</th><th style="text-align:right;">Balance</th><th>Due</th><th>Status</th>` +
            `</tr></thead><tbody>` +
            rows.slice(0, 100).map(rowHtml).join('') +
            `</tbody></table>` +
            `<p style="margin-top:1rem;font-size:.85rem;color:#475569;">` +
            `Open the Credit Orders module in Zachi Smart-POS to record a payment or send a WhatsApp nudge.` +
            `</p>` +
            `<p style="margin-top:.5rem;color:#94a3b8;font-size:.8rem;">— Zachi Smart-POS</p>`;

        const recipients = await getNotificationRecipients();
        for (const r of recipients) {
            try {
                await sendEmail(
                    r.email,
                    `Credit reminder — ${overdue.length} overdue, ${dueSoon.length} due within 7 days`,
                    html.replace('{{name}}', r.name || 'Director')
                );
            } catch (e) {
                console.error('[cron] credit-reminder email to', r.email, 'failed:', e.message);
            }
        }
    }

    // WhatsApp fan-out (logs only when no provider configured).
    try {
        await sendWhatsappAlert(
            `Credit reminder — ${overdue.length} overdue, ${dueSoon.length} due within 7 days`,
            summary
        );
    } catch (e) {
        console.error('[cron] credit-reminder whatsapp fan-out failed:', e.message);
    }

    // Stamp the sales we just nudged so the UI / future cron can see
    // when each balance was last reminded about.
    const ids = rows.map((r) => r.sale_id);
    if (ids.length > 0) {
        // sale_id is a uuid in this database (changed from serial in
        // an earlier migration), so cast the parameter array as
        // uuid[] — int[] would fail with "invalid input syntax".
        await pool.query(
            `UPDATE sales SET last_reminder_sent_at = NOW() WHERE sale_id = ANY($1::uuid[])`,
            [ids]
        );
    }
}

// =====================================================
// Nightly DB backup
// =====================================================
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Run pg_dump | gzip with no shell involvement so a malicious DATABASE_URL
// (e.g. one containing `;` or backticks) cannot be interpreted by /bin/sh.
function pgDumpToFile(connStr, outPath) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(outPath);
        const dump = spawn(
            'pg_dump',
            ['--no-owner', '--no-privileges', '--clean', '--if-exists', '--dbname', connStr],
            { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        const gzip = spawn('gzip', ['-9'], { stdio: ['pipe', 'pipe', 'pipe'] });

        let dumpErr = '';
        let gzipErr = '';
        dump.stderr.on('data', (b) => { dumpErr += b.toString(); });
        gzip.stderr.on('data', (b) => { gzipErr += b.toString(); });

        dump.stdout.pipe(gzip.stdin);
        gzip.stdout.pipe(out);

        let settled = false;
        const fail = (e) => {
            if (settled) return;
            settled = true;
            try { dump.kill(); } catch (_) { }
            try { gzip.kill(); } catch (_) { }
            reject(e);
        };

        dump.on('error', fail);
        gzip.on('error', fail);
        out.on('error', fail);

        out.on('close', () => {
            if (settled) return;
            settled = true;
            resolve();
        });

        gzip.on('exit', (code) => {
            if (code !== 0) fail(new Error(`gzip exited ${code}: ${gzipErr}`));
        });
        dump.on('exit', (code) => {
            if (code !== 0) fail(new Error(`pg_dump exited ${code}: ${dumpErr}`));
        });
    });
}

async function nightlyBackup() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
    ensureBackupDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(BACKUP_DIR, `zachi-pos-${ts}.sql.gz`);

    await pgDumpToFile(process.env.DATABASE_URL, file);

    // Rotate
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
        if (!f.startsWith('zachi-pos-') || !f.endsWith('.sql.gz')) continue;
        const full = path.join(BACKUP_DIR, f);
        try {
            const st = fs.statSync(full);
            if (st.mtimeMs < cutoff) fs.unlinkSync(full);
        } catch (_) { /* ignore */ }
    }

    const sizeKb = Math.round(fs.statSync(file).size / 1024);
    console.log(`[cron] backup written ${file} (${sizeKb} KB)`);
}

// =====================================================
// Public API
// =====================================================
function start() {
    if (started) return;
    if (process.env.DISABLE_CRON === 'true') {
        console.log('[cron] disabled via DISABLE_CRON');
        return;
    }
    if (process.env.NODE_ENV === 'test') return;

    // Hourly low-stock alert at minute 5 of each hour
    cron.schedule('5 * * * *', safeRun('low-stock-alert', lowStockAlert), { timezone: process.env.TZ || 'UTC' });

    // Daily credit reminder digest at 08:30 server time — early
    // enough that the director sees it with their morning coffee
    // but late enough that overnight payments have settled.
    cron.schedule('30 8 * * *', safeRun('credit-reminders', creditReminders), { timezone: process.env.TZ || 'UTC' });

    // Nightly backup at 02:00 server time
    cron.schedule('0 2 * * *', safeRun('nightly-backup', nightlyBackup), { timezone: process.env.TZ || 'UTC' });

    started = true;
    console.log('[cron] scheduler started — low-stock hourly, credit-reminders @08:30, backup nightly @02:00');
}

module.exports = { start, lowStockAlert, creditReminders, nightlyBackup, getNotificationRecipients, getWhatsappRecipients, sendWhatsappAlert };
