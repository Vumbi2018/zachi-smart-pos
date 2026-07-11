/**
 * Customer-Facing Display
 *
 * Lightweight Server-Sent Events channel that streams the cashier's
 * live cart to a second screen at /display.html. The cashier (POS) POSTs
 * its current cart on every change; subscribers (display screens) get
 * an `event: cart` push immediately.
 *
 * Channels are namespaced by `terminal` (defaults to "main") so a shop
 * with multiple lanes can run multiple displays without crosstalk.
 *
 * No persistence — purely in-memory. If the server restarts the displays
 * just reconnect via the EventSource auto-reconnect.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// terminal -> Set<res>
const channels = new Map();
// terminal -> last cart payload (so a fresh display gets the current state)
const lastState = new Map();

function getChannel(terminal) {
    if (!channels.has(terminal)) channels.set(terminal, new Set());
    return channels.get(terminal);
}

function broadcast(terminal, event, data) {
    const subs = channels.get(terminal);
    if (!subs || subs.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) {
        try { res.write(payload); } catch (_) { /* dead connection — cleanup on close */ }
    }
}

/**
 * GET /api/display/stream?terminal=main
 *
 * Open SSE channel. No auth on the SSE itself — it's read-only and the
 * worst case is a customer screen showing a cart total. We keep the
 * push endpoint authenticated so only logged-in cashiers can write.
 */
router.get('/stream', (req, res) => {
    const terminal = (req.query.terminal || 'main').toString().slice(0, 32);

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const subs = getChannel(terminal);
    subs.add(res);

    // Replay last state immediately so the screen isn't blank on reload
    const last = lastState.get(terminal);
    if (last) res.write(`event: cart\ndata: ${JSON.stringify(last)}\n\n`);

    // Heartbeat every 25s — keeps proxies from idling out the connection
    const hb = setInterval(() => {
        try { res.write(': hb\n\n'); } catch (_) { /* ignore */ }
    }, 25000);

    req.on('close', () => {
        clearInterval(hb);
        subs.delete(res);
    });
});

/**
 * POST /api/display/cart
 * Body: { terminal?: string, items: [...], subtotal, tax, total, customer? }
 *
 * Cashier (POS) sends this on every cart change. Authenticated.
 */
router.post('/cart', auth, (req, res) => {
    const terminal = (req.body?.terminal || 'main').toString().slice(0, 32);
    const payload = {
        items: Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [],
        subtotal: Number(req.body?.subtotal) || 0,
        tax: Number(req.body?.tax) || 0,
        total: Number(req.body?.total) || 0,
        discount: Number(req.body?.discount) || 0,
        customer: req.body?.customer || null,
        cashier: req.user?.full_name || req.user?.username || null,
        ts: Date.now(),
    };
    lastState.set(terminal, payload);
    broadcast(terminal, 'cart', payload);
    res.json({ ok: true });
});

/**
 * POST /api/display/welcome
 * Body: { terminal?: string }
 *
 * Sent after a sale completes — clears the screen back to the welcome state.
 */
router.post('/welcome', auth, (req, res) => {
    const terminal = (req.body?.terminal || 'main').toString().slice(0, 32);
    lastState.delete(terminal);
    broadcast(terminal, 'welcome', { ts: Date.now() });
    res.json({ ok: true });
});

/**
 * POST /api/display/thanks
 * Body: { terminal?: string, total, change?, sale_number? }
 * Sent on sale completion — flashes a thank-you with the change due.
 */
router.post('/thanks', auth, (req, res) => {
    const terminal = (req.body?.terminal || 'main').toString().slice(0, 32);
    broadcast(terminal, 'thanks', {
        total: Number(req.body?.total) || 0,
        change: Number(req.body?.change) || 0,
        sale_number: req.body?.sale_number || null,
        ts: Date.now(),
    });
    res.json({ ok: true });
});

module.exports = router;
