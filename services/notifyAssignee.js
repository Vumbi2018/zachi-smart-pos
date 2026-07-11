'use strict';

/**
 * notifyAssignee — fan-out helper used whenever a job card is
 * assigned or reassigned (v1.0.22).
 *
 * Per the spec, EMAIL / SMS / WhatsApp are the *primary* delivery
 * channels — the operator may not be logged into the POS at the
 * time we want to reach them. The in-app bell-icon notification
 * stays as a secondary surface for anyone who happens to be online.
 *
 * Each channel runs in its own try/catch so a single bad config
 * (no SMTP, SMS provider down, WhatsApp webhook 500) cannot block
 * the others or roll back the job save. Every attempt emits a line
 * tagged `[notify-assignee]` so we can grep production logs for
 * delivery confirmation.
 *
 * The helper is deliberately fire-and-forget from the controller's
 * perspective — callers do `notifyAssignee(...).catch(()=>{})` and
 * return their HTTP response immediately.
 */

const pool = require('../db/pool');
const NotificationController = require('../controllers/notificationController');
const { sendEmail } = require('../utils/email');
const messaging = require('./messaging');

const TAG = '[notify-assignee]';

async function _loadUser(userId) {
    if (!userId) return null;
    try {
        const r = await pool.query(
            'SELECT user_id, full_name, username, email, phone FROM users WHERE user_id = $1',
            [userId]
        );
        return r.rows[0] || null;
    } catch (e) {
        console.error(`${TAG} could not load user ${userId}: ${e.message}`);
        return null;
    }
}

/** Best-effort customer name lookup. Returns 'Walk-in' on miss/err so
 *  the email/SMS body always has *something* useful for the assignee. */
async function _loadCustomerName(customerId) {
    if (!customerId) return 'Walk-in';
    try {
        const r = await pool.query(
            'SELECT full_name FROM customers WHERE customer_id = $1',
            [customerId]
        );
        return (r.rows[0] && r.rows[0].full_name) || 'Walk-in';
    } catch (e) {
        console.warn(`${TAG} could not load customer ${customerId}: ${e.message}`);
        return 'Walk-in';
    }
}

/** v1.0.24 — Best-effort service name lookup. The job object passed
 *  by the controller comes straight from `INSERT ... RETURNING *`, so
 *  it has `service_id` but no joined `service_name`. We fetch the
 *  human-readable name here so the email/SMS body can say "Business
 *  Cards" instead of an opaque UUID. Returns null on miss so the
 *  template can omit the row gracefully. */
async function _loadServiceName(serviceId) {
    if (!serviceId) return null;
    try {
        const r = await pool.query(
            'SELECT service_name FROM services WHERE service_id = $1',
            [serviceId]
        );
        return (r.rows[0] && r.rows[0].service_name) || null;
    } catch (e) {
        console.warn(`${TAG} could not load service ${serviceId}: ${e.message}`);
        return null;
    }
}

/** v1.0.24 — money formatter for K (Zambian Kwacha). Coerces nulls /
 *  strings (numeric columns sometimes round-trip as strings via pg)
 *  safely to a fixed 2-dp string. */
function _money(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return `K${n.toFixed(2)}`;
}

/** v1.0.24 — clip long specifications text so it fits in an SMS
 *  segment (160 chars total) without blowing the per-message limit
 *  and so the email card stays readable. Strips control chars. */
function _clipSpec(text, max) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** Build a deep link back to the job card. Falls back to a hash route
 *  on the configured APP_BASE_URL; if APP_BASE_URL isn't set the link
 *  still works as a relative path inside the same browser session. */
function _jobDeepLink(job) {
    // Prefer an explicit APP_BASE_URL, then fall back to the Replit
    // public preview domain (so dev/staging emails still get a real
    // clickable link), then to the first REPLIT_DOMAINS entry, and
    // finally to a relative hash path. SMS/WhatsApp need an absolute
    // URL to be tappable, so the relative fallback is last-resort.
    const explicit = (process.env.APP_BASE_URL || '').trim();
    const dev      = (process.env.REPLIT_DEV_DOMAIN || '').trim();
    const domains  = (process.env.REPLIT_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
    let base = explicit || (dev ? `https://${dev}` : '') || (domains[0] ? `https://${domains[0]}` : '');
    base = base.replace(/\/$/, '');
    const path = `/#/jobs/${job.job_id}`;
    return base ? `${base}${path}` : path;
}

function _escapeHtml(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _buildSubject(job, reason) {
    const tag = reason === 'reassigned' ? 'reassigned to you' : 'assigned to you';
    return `Zachi POS: Job ${job.job_number} ${tag}`;
}

function _buildShortBody(job, reason, customerName, deepLink, serviceName) {
    // v1.0.24 — give the assignee enough context to triage from the
    // notification alone: service, customer, deadline, priority, money
    // owed, and a short specifications snippet. The assignee should
    // not need to open the app just to know what they're being asked
    // to do or how urgent it is.
    const verb = reason === 'reassigned' ? 'reassigned to you' : 'assigned to you';
    const parts = [`Zachi POS: Job ${job.job_number} ${verb}.`];
    if (serviceName) parts.push(`Service: ${serviceName}.`);
    if (customerName) parts.push(`Customer: ${customerName}.`);
    if (job.deadline) {
        const d = new Date(job.deadline);
        if (!isNaN(d.getTime())) parts.push(`Deadline: ${d.toISOString().slice(0, 10)}.`);
    }
    if (job.priority && job.priority !== 'Normal') parts.push(`Priority: ${job.priority}.`);
    const balance = _money(job.balance_due);
    if (balance) parts.push(`Balance: ${balance}.`);
    const spec = _clipSpec(job.specifications, 70);
    if (spec) parts.push(`Spec: ${spec}`);
    if (deepLink) parts.push(`Open: ${deepLink}`);
    return parts.join(' ');
}

function _buildEmailHtml(job, user, reason, customerName, deepLink, serviceName) {
    // v1.0.24 — richer email template. Adds Service, Specifications
    // (multi-line block, not a table cell so newlines survive), and
    // a Financials summary (estimated cost / deposit / balance) so
    // the operator knows up front how much money is on the line.
    const verb = reason === 'reassigned' ? 'reassigned to you' : 'assigned to you';
    const safeName = (user && user.full_name) ? user.full_name : 'there';
    const dl = job.deadline ? new Date(job.deadline).toISOString().slice(0, 10) : '—';
    const linkHref = _escapeHtml(deepLink);

    const estimated = _money(job.estimated_cost);
    const deposit   = _money(job.deposit_amount);
    const balance   = _money(job.balance_due);
    const rushFee   = _money(job.rush_fee);

    const moneyRows = [];
    if (estimated) moneyRows.push(`<tr><td style="padding:4px 12px 4px 0;color:#666">Estimated cost</td><td>${_escapeHtml(estimated)}</td></tr>`);
    if (rushFee && Number(job.rush_fee) > 0) moneyRows.push(`<tr><td style="padding:4px 12px 4px 0;color:#666">Rush fee</td><td>${_escapeHtml(rushFee)}</td></tr>`);
    if (deposit) moneyRows.push(`<tr><td style="padding:4px 12px 4px 0;color:#666">Deposit paid</td><td>${_escapeHtml(deposit)}</td></tr>`);
    if (balance) moneyRows.push(`<tr><td style="padding:4px 12px 4px 0;color:#666">Balance due</td><td><b>${_escapeHtml(balance)}</b></td></tr>`);

    const specText = String(job.specifications == null ? '' : job.specifications).trim();
    const specBlock = specText
        ? `<div style="margin:12px 0">
               <div style="font-size:12px;color:#666;margin-bottom:4px">Specifications</div>
               <div style="white-space:pre-wrap;background:#f4f6f8;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:13px;line-height:1.45">${_escapeHtml(specText)}</div>
           </div>`
        : '';

    return `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#222">
            <h2 style="color:#0f766e;margin:0 0 12px">Job ${_escapeHtml(job.job_number)} ${verb}</h2>
            <p>Hi ${_escapeHtml(safeName)},</p>
            <p>You have been ${verb} on Zachi POS.</p>
            <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
                <tr><td style="padding:4px 12px 4px 0;color:#666">Job number</td><td><b>${_escapeHtml(job.job_number)}</b></td></tr>
                ${serviceName ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Service</td><td>${_escapeHtml(serviceName)}</td></tr>` : ''}
                <tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td><td>${_escapeHtml(customerName || 'Walk-in')}${job.customer_type ? ` <span style="color:#888;font-size:12px">(${_escapeHtml(job.customer_type)})</span>` : ''}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#666">Status</td><td>${_escapeHtml(job.status || 'Pending')}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#666">Priority</td><td>${_escapeHtml(job.priority || 'Normal')}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#666">Deadline</td><td>${_escapeHtml(dl)}</td></tr>
                ${moneyRows.join('')}
            </table>
            ${specBlock}
            <p style="margin:18px 0">
                <a href="${linkHref}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">
                    Open job card →
                </a>
            </p>
            <p style="font-size:12px;color:#888">Or paste this link into your browser: ${linkHref}</p>
        </div>
    `;
}

async function _viaEmail(user, job, reason, customerName, deepLink, serviceName) {
    if (!user || !user.email) {
        console.warn(`${TAG} channel=email user=${user && user.user_id} skip reason=no_email`);
        return { ok: false, reason: 'no_email' };
    }
    try {
        const info = await sendEmail(
            user.email,
            _buildSubject(job, reason),
            _buildEmailHtml(job, user, reason, customerName, deepLink, serviceName),
            []
        );
        console.log(`${TAG} channel=email user=${user.user_id} ok msg=${(info && info.messageId) || '-'}`);
        return { ok: true };
    } catch (e) {
        console.warn(`${TAG} channel=email user=${user.user_id} err ${e.message || e}`);
        return { ok: false, reason: 'email_error', error: String(e.message || e) };
    }
}

async function _viaSms(user, job, reason, customerName, deepLink, serviceName) {
    if (!user || !user.phone) {
        console.warn(`${TAG} channel=sms user=${user && user.user_id} skip reason=no_phone`);
        return { ok: false, reason: 'no_phone' };
    }
    try {
        const r = await messaging.sendSms({
            to: user.phone,
            subject: _buildSubject(job, reason),
            body: _buildShortBody(job, reason, customerName, deepLink, serviceName),
            meta: { job_id: job.job_id, job_number: job.job_number, reason },
        });
        if (r.ok) {
            console.log(`${TAG} channel=sms user=${user.user_id} ok http=${r.http || '-'}`);
        } else {
            console.warn(`${TAG} channel=sms user=${user.user_id} skip reason=${r.reason}`);
        }
        return r;
    } catch (e) {
        console.warn(`${TAG} channel=sms user=${user.user_id} err ${e.message || e}`);
        return { ok: false, reason: 'sms_error', error: String(e.message || e) };
    }
}

async function _viaWhatsapp(user, job, reason, customerName, deepLink, serviceName) {
    if (!user || !user.phone) {
        console.warn(`${TAG} channel=whatsapp user=${user && user.user_id} skip reason=no_phone`);
        return { ok: false, reason: 'no_phone' };
    }
    try {
        const r = await messaging.sendWhatsapp({
            to: user.phone,
            subject: _buildSubject(job, reason),
            body: _buildShortBody(job, reason, customerName, deepLink, serviceName),
            meta: { job_id: job.job_id, job_number: job.job_number, reason },
        });
        if (r.ok) {
            console.log(`${TAG} channel=whatsapp user=${user.user_id} ok http=${r.http || '-'}`);
        } else {
            console.warn(`${TAG} channel=whatsapp user=${user.user_id} skip reason=${r.reason}`);
        }
        return r;
    } catch (e) {
        console.warn(`${TAG} channel=whatsapp user=${user.user_id} err ${e.message || e}`);
        return { ok: false, reason: 'whatsapp_error', error: String(e.message || e) };
    }
}

async function _viaInApp(user, job, reason) {
    if (!user) return { ok: false, reason: 'no_user' };
    try {
        const verb = reason === 'reassigned' ? 'reassigned to you' : 'assigned to you';
        await NotificationController.createNotification(
            user.user_id,
            'job_assigned',
            `Job ${job.job_number} ${verb}`,
            job.job_id
        );
        console.log(`${TAG} channel=in_app user=${user.user_id} ok`);
        return { ok: true };
    } catch (e) {
        console.warn(`${TAG} channel=in_app user=${user.user_id} err ${e.message || e}`);
        return { ok: false, reason: 'in_app_error', error: String(e.message || e) };
    }
}

/**
 * @param {string} userId        UUID of the assignee.
 * @param {object} job           Row from job_cards (job_id, job_number, status, priority, deadline).
 * @param {'assigned'|'reassigned'} reason
 */
async function notifyAssignee(userId, job, reason = 'assigned') {
    // v1.0.24 — also resolve service_name in parallel so the email
    // and SMS bodies can name the work item ("Business Cards") rather
    // than show an opaque service UUID. Falls through gracefully when
    // the lookup fails.
    const [user, customerName, serviceName] = await Promise.all([
        _loadUser(userId),
        _loadCustomerName(job && job.customer_id),
        _loadServiceName(job && job.service_id),
    ]);
    if (!user) {
        console.warn(`${TAG} skipping — could not load user ${userId} for job ${job && job.job_number}`);
        return { email: null, sms: null, whatsapp: null, in_app: null };
    }
    const deepLink = _jobDeepLink(job);

    // Fan out in parallel. Each promise already swallows its own
    // errors, so Promise.all is safe (no rejection bubbles).
    const [email, sms, whatsapp, in_app] = await Promise.all([
        _viaEmail(user, job, reason, customerName, deepLink, serviceName),
        _viaSms(user, job, reason, customerName, deepLink, serviceName),
        _viaWhatsapp(user, job, reason, customerName, deepLink, serviceName),
        _viaInApp(user, job, reason),
    ]);
    return { email, sms, whatsapp, in_app };
}

module.exports = { notifyAssignee };
