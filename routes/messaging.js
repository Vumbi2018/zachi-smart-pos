'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const messaging = require('../services/messaging');

router.use(auth);

router.get('/status', async (_req, res) => {
    try {
        const s = await messaging.getStatus();
        res.json(s);
    } catch (e) {
        res.status(500).json({ error: 'status_failed', message: e.message });
    }
});

router.post('/sms', async (req, res) => {
    try {
        const { to, body, subject, meta } = req.body || {};
        if (!to || !body) return res.status(400).json({ error: 'missing_fields', required: ['to', 'body'] });
        const r = await messaging.sendSms({ to, body, subject, meta });
        if (!r.ok) return res.status(502).json({ error: 'send_failed', detail: r });
        res.json({ ok: true, channel: 'sms' });
    } catch (e) {
        res.status(500).json({ error: 'unhandled', message: e.message });
    }
});

router.post('/whatsapp', async (req, res) => {
    try {
        const { to, body, subject, meta } = req.body || {};
        if (!to || !body) return res.status(400).json({ error: 'missing_fields', required: ['to', 'body'] });
        const r = await messaging.sendWhatsapp({ to, body, subject, meta });
        if (!r.ok) return res.status(502).json({ error: 'send_failed', detail: r });
        res.json({ ok: true, channel: 'whatsapp' });
    } catch (e) {
        res.status(500).json({ error: 'unhandled', message: e.message });
    }
});

router.post('/bulk', authorize('director'), async (req, res) => {
    try {
        const { channel, recipients, subject, body, meta } = req.body || {};
        if (!channel || !['sms', 'whatsapp'].includes(channel)) {
            return res.status(400).json({ error: 'invalid_channel' });
        }
        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'no_recipients' });
        }
        if (!body) return res.status(400).json({ error: 'missing_body' });
        const results = await messaging.sendBulk(channel, recipients, { subject, body, meta });
        const okCount = results.filter((r) => r.ok).length;
        res.json({ ok: true, total: results.length, sent: okCount, failed: results.length - okCount, results });
    } catch (e) {
        res.status(500).json({ error: 'unhandled', message: e.message });
    }
});

module.exports = router;
