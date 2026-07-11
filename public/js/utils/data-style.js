/**
 * Zachi Smart-POS — CSP-safe inline-style applier.
 *
 * Task #5 removed `script-src-attr 'unsafe-inline'`; Task #7 removes the last
 * `'unsafe-inline'` allowance in `style-src`. Once that allowance is gone the
 * browser refuses to honour any `style="…"` HTML attribute, even on freshly
 * `innerHTML`-injected nodes. Thousands of legacy template strings still emit
 * `style="…"` (often with interpolated values like `width:${pct}%`), so a
 * mechanical migration to CSS classes is impractical.
 *
 * Instead the codebase now writes those styles as `data-style="…"` and this
 * module copies them onto the element via per-declaration
 * `CSSStyleDeclaration.setProperty()` calls. Per CSP3 §6.7, only the
 * `style` attribute setter and `CSSStyleDeclaration.cssText` setter are
 * gated on `style-src-attr` — `setProperty` is NOT, so it works under a
 * strict `style-src` with no `'unsafe-inline'`:
 *
 *   <div data-style="width:${pct}%;background:${color}"></div>
 *
 * After application the `data-style` attribute is removed so the same element
 * is never re-applied on subsequent observer ticks.
 *
 * The applier runs:
 *   1. Once over the entire document on init (catches static markup in
 *      index.html).
 *   2. On every `MutationObserver` `childList` notification, walking every
 *      added subtree (catches the SPA's heavy `innerHTML = …` usage).
 *   3. On `attributes` notifications when `data-style` itself is set on a
 *      pre-existing element via `setAttribute`.
 *
 * A small `window.DataStyle.apply(root)` hook is exposed for the rare cases
 * where calling code must apply styles synchronously before the observer's
 * microtask fires (e.g. measurements taken immediately after assignment).
 */
(function () {
    'use strict';

    // Split a CSS declaration block on top-level `;`, respecting parentheses
    // (e.g. `background: rgb(255,0,0); width: 50%`) and double / single
    // quoted strings (e.g. `content: ";"; color: red`).
    function splitDecls(css) {
        const out = [];
        let depth = 0, inSingle = false, inDouble = false, buf = '';
        for (let i = 0; i < css.length; i++) {
            const c = css.charCodeAt(i);
            const ch = css[i];
            if (inSingle) {
                buf += ch;
                if (c === 39 /* ' */ && css[i - 1] !== '\\') inSingle = false;
            } else if (inDouble) {
                buf += ch;
                if (c === 34 /* " */ && css[i - 1] !== '\\') inDouble = false;
            } else if (c === 39) { inSingle = true; buf += ch; }
            else if (c === 34) { inDouble = true; buf += ch; }
            else if (c === 40 /* ( */) { depth++; buf += ch; }
            else if (c === 41 /* ) */) { depth--; buf += ch; }
            else if (c === 59 /* ; */ && depth === 0) {
                if (buf.trim() !== '') out.push(buf);
                buf = '';
            } else {
                buf += ch;
            }
        }
        if (buf.trim() !== '') out.push(buf);
        return out;
    }

    function applyOne(el) {
        // Guard against non-element nodes and elements without the attribute.
        if (!el || el.nodeType !== 1 || !el.hasAttribute('data-style')) return;
        const css = el.getAttribute('data-style');
        // Apply per-declaration via setProperty — not gated by style-src.
        // (Bulk `style.cssText = …` and the `style` attribute setter both ARE
        // gated, so we deliberately avoid them.)
        const decls = splitDecls(css);
        const style = el.style;
        if (style && typeof style.setProperty === 'function') {
            for (let i = 0; i < decls.length; i++) {
                const decl = decls[i];
                const colon = decl.indexOf(':');
                if (colon <= 0) continue;
                const prop = decl.slice(0, colon).trim();
                let value = decl.slice(colon + 1).trim();
                if (!prop) continue;
                // Detect and strip `!important` so we can pass it as the
                // priority argument (setProperty rejects it inside `value`).
                let priority = '';
                const bangIdx = value.toLowerCase().lastIndexOf('!important');
                if (bangIdx !== -1) {
                    value = value.slice(0, bangIdx).trim();
                    priority = 'important';
                }
                try { style.setProperty(prop, value, priority); }
                catch (_) { /* unknown / invalid declaration — ignore */ }
            }
        }
        el.removeAttribute('data-style');
    }

    function applyAll(root) {
        if (!root) return;
        // Element root may itself carry data-style.
        if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-style')) {
            applyOne(root);
        }
        // querySelectorAll exists on Document, Element and DocumentFragment.
        if (typeof root.querySelectorAll === 'function') {
            const list = root.querySelectorAll('[data-style]');
            for (let i = 0; i < list.length; i++) applyOne(list[i]);
        }
    }

    function onMutations(mutations) {
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (m.type === 'childList') {
                const added = m.addedNodes;
                for (let j = 0; j < added.length; j++) applyAll(added[j]);
            } else if (m.type === 'attributes' && m.attributeName === 'data-style') {
                applyOne(m.target);
            }
        }
    }

    function init() {
        // 1) Initial sweep — covers anything already in the document at
        // DOMContentLoaded (static markup in index.html, modal templates, etc).
        applyAll(document);

        // 2) Live observer — covers every subsequent innerHTML / appendChild.
        const obs = new MutationObserver(onMutations);
        obs.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-style'],
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public hook for synchronous application.
    window.DataStyle = { apply: applyAll, applyOne };
})();
