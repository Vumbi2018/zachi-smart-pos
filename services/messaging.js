'use strict';

const pool = require('../db/pool');

const SETTING_KEYS = [
    'messaging.sms.provider',
    'messaging.sms.webhook_url',
    'messaging.sms.webhook_token',
    'messaging.sms.from_number',
    'messaging.whatsapp.provider',
    'messaging.whatsapp.webhook_url',
    'messaging.whatsapp.webhook_token',
    'messaging.whatsapp.from_number',
];

let cache = null;
let cacheAt = 0;
const TTL_MS = 30 * 1000;

async function _loadConfig() {
    const now = Date.now();
    if (cache && (now - cacheAt) < TTL_MS) return cache;
    const out = {};
    try {
        const r = await pool.query(
            'SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1::text[])',
            [SETTING_KEYS]
        );
        for (const row of r.rows) out[row.setting_key] = row.setting_value;
    } catch (e) {
        console.error('[messaging] load config failed:', e.message);
    }
    cache = out;
    cacheAt = now;
    return out;
}

function invalidateCache() { cache = null; cacheAt = 0; }

function _channelConfig(cfg, channel) {
    const k = (suffix) => `messaging.${channel}.${suffix}`;
    const envPrefix = channel === 'sms' ? 'SMS' : 'WHATSAPP';
    return {
        provider: ((cfg[k('provider')] || process.env[`${envPrefix}_PROVIDER`] || '') + '').trim().toLowerCase(),
        url:      ((cfg[k('webhook_url')] || process.env[`${envPrefix}_WEBHOOK_URL`] || '') + '').trim(),
        token:    ((cfg[k('webhook_token')] || process.env[`${envPrefix}_WEBHOOK_TOKEN`] || '') + '').trim(),
        from:     ((cfg[k('from_number')] || process.env[`${envPrefix}_FROM_NUMBER`] || '') + '').trim(),
    };
}

function _normPhone(p) {
    return String(p || '').replace(/[\s\-()]/g, '').trim();
}

async function _postWebhook({ url, token, body, timeoutMs }) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const ok = res.ok;
        let detail = null;
        try { detail = await res.text(); } catch (_) {}
        return { ok, status: res.status, detail };
    } finally {
        clearTimeout(timer);
    }
}

async function _sendOne(channel, { to, body, subject, meta }) {
    const cfg = await _loadConfig();
    const ch = _channelConfig(cfg, channel);
    const phone = _normPhone(to);
    if (!phone) {
        return { ok: false, reason: 'missing_to', channel };
    }
    if (!ch.provider) {
        return { ok: false, reason: 'no_provider', channel };
    }
    if (ch.provider !== 'webhook') {
        return { ok: false, reason: 'unsupported_provider', channel, provider: ch.provider };
    }
    if (!ch.url) {
        return { ok: false, reason: 'no_webhook_url', channel };
    }

    const payload = {
        channel,
        from: ch.from || null,
        to: phone,
        body: String(body || ''),
        subject: subject ? String(subject) : null,
        meta: meta || null,
        sent_at: new Date().toISOString(),
    };
    try {
        const r = await _postWebhook({ url: ch.url, token: ch.token, body: payload, timeoutMs: 8000 });
        if (!r.ok) {
            return { ok: false, reason: 'webhook_http_' + r.status, channel, http: r.status };
        }
        return { ok: true, channel, http: r.status };
    } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'timeout' : (e.message || String(e));
        return { ok: false, reason: 'webhook_error', channel, error: msg };
    }
}

async function sendSms(opts) { return _sendOne('sms', opts); }
async function sendWhatsapp(opts) { return _sendOne('whatsapp', opts); }

async function sendBulk(channel, recipients, { subject, body, meta } = {}) {
    const tasks = (recipients || []).map((r) => {
        const to = typeof r === 'string' ? r : r.phone;
        return _sendOne(channel, { to, subject, body, meta });
    });
    const results = await Promise.allSettled(tasks);
    return results.map((res, i) =>
        res.status === 'fulfilled'
            ? res.value
            : { ok: false, reason: 'exception', channel, error: String(res.reason) }
    );
}

async function getStatus() {
    const cfg = await _loadConfig();
    const sms = _channelConfig(cfg, 'sms');
    const wa = _channelConfig(cfg, 'whatsapp');
    return {
        sms: {
            configured: !!(sms.provider && sms.url),
            provider: sms.provider || null,
            from: sms.from || null,
        },
        whatsapp: {
            configured: !!(wa.provider && wa.url),
            provider: wa.provider || null,
            from: wa.from || null,
        },
    };
}

module.exports = {
    sendSms,
    sendWhatsapp,
    sendBulk,
    getStatus,
    invalidateCache,
};
