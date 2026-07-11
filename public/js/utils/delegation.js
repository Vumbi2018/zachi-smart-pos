/**
 * Zachi Smart-POS — Delegated event dispatcher (CSP-safe).
 *
 * Replaces inline `onclick="…"` / `onsubmit="…"` / etc. attributes — which
 * require `script-src-attr 'unsafe-inline'` — with `data-on-<event>="…"`
 * attributes resolved by a single delegated listener attached to `document`.
 *
 *   <button data-on-click="Customers.delete(5)">Delete</button>
 *   <input  data-on-input="POS.updateDiscount($value)">
 *   <form   data-on-submit="Returns.submitReturn($event)">
 *
 * Supported events: click, submit, change, input, keyup, dragover,
 * dragleave, drop, blur, focus (capture).
 *
 * Spec grammar:  Namespace.method(arg1, arg2, ...)
 * Args may be:   numbers, "strings" / 'strings', true/false/null/undefined,
 *                or one of the special tokens listed below.
 *
 * Tokens (substituted at dispatch time):
 *   $event    — the raw DOM event
 *   $el       — the element carrying the data-on-X attribute
 *   $target   — event.target
 *   $value    — el.value          (string)
 *   $valueNum — parseFloat(el.value)
 *   $valueInt — parseInt(el.value, 10)
 *   $checked  — el.checked        (boolean)
 *   $files0   — el.files && el.files[0]
 *
 * Stop-propagation:
 *   <td data-stop="click">…</td>            // swallows click before any
 *                                            // ancestor handler is reached
 *   data-stop="click,change"  /  data-stop="all"
 *
 * Single-fire semantics:
 *   The dispatcher walks up from event.target and fires the FIRST element
 *   carrying data-on-<event>. Inner handlers naturally take precedence over
 *   outer ones — no manual stopPropagation is required for nested handlers
 *   that both have data-on-X attributes.
 */
(function () {
    'use strict';

    // Bubbling events handled in the bubble phase
    const BUBBLE_EVENTS = ['click', 'submit', 'change', 'input', 'keyup',
        'keydown', 'dragover', 'dragleave', 'drop'];
    // Non-bubbling events handled in the capture phase
    const CAPTURE_EVENTS = ['blur', 'focus', 'load', 'error'];

    function resolveFn(path) {
        const parts = path.split('.');
        let obj = window;
        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj && obj[parts[i]];
            if (!obj) return null;
        }
        const last = parts[parts.length - 1];
        const fn = obj && obj[last];
        if (typeof fn !== 'function') return null;
        return fn.bind(obj);
    }

    function decodeStringLiteral(s) {
        // s is the raw inner contents between the quotes
        return s
            .replace(/\\\\/g, '\u0000')
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\u0000/g, '\\');
    }

    function parseArg(s, ctx) {
        s = s.trim();
        if (s === '') return undefined;
        if (s.charAt(0) === '$') {
            switch (s) {
                case '$event': return ctx.event;
                case '$el': return ctx.el;
                case '$target': return ctx.event.target;
                case '$value': return ctx.el.value;
                case '$valueNum': return parseFloat(ctx.el.value);
                case '$valueInt': return parseInt(ctx.el.value, 10);
                case '$checked': return ctx.el.checked;
                case '$files0': return ctx.el.files && ctx.el.files[0];
                default: return undefined;
            }
        }
        if (s === 'true') return true;
        if (s === 'false') return false;
        if (s === 'null') return null;
        if (s === 'undefined') return undefined;
        if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
        const first = s.charAt(0);
        const last = s.charAt(s.length - 1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return decodeStringLiteral(s.slice(1, -1));
        }
        // Array literal:  recursively parse each element through parseArg so
        // single-quoted strings, nested arrays, and tokens all work.
        if (first === '[' && last === ']') {
            const inner = s.slice(1, -1);
            if (inner.trim() === '') return [];
            return splitArgs(inner).map(t => parseArg(t, ctx));
        }
        // Object literal: only JSON-syntax (double-quoted keys/strings).
        // Anything else is an authoring error and falls through to raw text.
        if (first === '{' && last === '}') {
            try { return JSON.parse(s); } catch (_) { /* fall through */ }
        }
        // Fallback: pass raw text (rare; mostly an authoring error)
        return s;
    }

    // Split top-level comma-separated args while respecting strings and parens
    function splitArgs(s) {
        const out = [];
        let depth = 0, inSingle = false, inDouble = false, buf = '';
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inSingle) {
                buf += c;
                if (c === "'" && s[i - 1] !== '\\') inSingle = false;
            } else if (inDouble) {
                buf += c;
                if (c === '"' && s[i - 1] !== '\\') inDouble = false;
            } else if (c === "'") { inSingle = true; buf += c; }
            else if (c === '"') { inDouble = true; buf += c; }
            else if (c === '(' || c === '[' || c === '{') { depth++; buf += c; }
            else if (c === ')' || c === ']' || c === '}') { depth--; buf += c; }
            else if (c === ',' && depth === 0) { out.push(buf); buf = ''; }
            else buf += c;
        }
        if (buf.length > 0 || out.length > 0) out.push(buf);
        return out;
    }

    function parseCall(spec) {
        const trimmed = spec.trim();
        const m = trimmed.match(/^([A-Za-z_$][\w$.]*)\s*(?:\(([\s\S]*)\))?\s*$/);
        if (!m) return null;
        const name = m[1];
        const argsStr = m[2] || '';
        const argTokens = argsStr.trim() === '' ? [] : splitArgs(argsStr);
        return { name, argTokens };
    }

    function shouldSwallow(stopAttr, eventType) {
        if (!stopAttr) return false;
        if (stopAttr === 'all') return true;
        const list = stopAttr.split(/[,\s]+/);
        return list.indexOf(eventType) !== -1;
    }

    function dispatch(eventType, event) {
        const attr = 'data-on-' + eventType;
        let el = event.target;
        while (el && el !== document && el.nodeType === 1) {
            if (el.hasAttribute(attr)) {
                const spec = el.getAttribute(attr);
                if (!spec) return;
                const parsed = parseCall(spec);
                if (!parsed) {
                    console.warn('[delegation] bad spec:', spec);
                    return;
                }
                const fn = resolveFn(parsed.name);
                if (!fn) {
                    console.warn('[delegation] unresolved handler:', parsed.name);
                    return;
                }
                const ctx = { event, el };
                const args = parsed.argTokens.map(t => parseArg(t, ctx));
                try { fn.apply(null, args); }
                catch (err) { console.error('[delegation] handler error', spec, err); }
                return;
            }
            if (shouldSwallow(el.getAttribute('data-stop'), eventType)) {
                return; // Inner element swallows the event without firing a handler
            }
            el = el.parentNode;
        }
    }

    function init() {
        BUBBLE_EVENTS.forEach(ev =>
            document.addEventListener(ev, (e) => dispatch(ev, e), false)
        );
        CAPTURE_EVENTS.forEach(ev =>
            document.addEventListener(ev, (e) => dispatch(ev, e), true)
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── Shared DOM helpers — referenced from data-on-X specs ──────────────
    window.Dom = window.Dom || {
        /** Remove the closest ancestor matching `selector` from `el`. */
        removeClosest(selector, el) {
            const node = el && el.closest && el.closest(selector);
            if (node) node.remove();
        },
        /** Remove element with the given id, if present. */
        removeById(id) {
            const node = document.getElementById(id);
            if (node) node.remove();
        },
        /** Programmatic .click() on element with the given id. */
        clickById(id) {
            const node = document.getElementById(id);
            if (node) node.click();
        },
        /** Trigger the browser print dialog. */
        print() { window.print(); },
        /** Submit the form with the given id. */
        submitById(id) {
            const f = document.getElementById(id);
            if (f) f.requestSubmit ? f.requestSubmit() : f.submit();
        },
        /** Navigate the SPA via hash. */
        navigate(hash) { window.location.hash = hash; },
        /** Set element value by id and trigger optional callback name. */
        setValueById(id, value) {
            const el = document.getElementById(id);
            if (el) el.value = value;
        },
    };

    // Expose internals so tests can exercise the parser without a real DOM.
    // Browsers ignore this; Node's vm runner reads it back.
    if (typeof window !== 'undefined') {
        window.__Delegation = { parseCall, parseArg, splitArgs };
    }
})();
