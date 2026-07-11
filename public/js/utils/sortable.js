/**
 * sortable.js — minimal, dependency-free helper for clickable
 * column-header sorting on any list table.
 *
 * Usage pattern (per list page):
 *   const sort = Sortable.create({
 *     defaultKey: 'created_at',
 *     defaultDir: 'desc',
 *     onChange: () => MyModule.render(),
 *   });
 *
 *   // In your render():
 *   const tableHtml = `
 *     <table>
 *       <thead><tr>
 *         ${sort.header('Name', 'full_name')}
 *         ${sort.header('Phone', 'phone')}
 *         ${sort.header('Joined', 'created_at', { numeric: false })}
 *       </tr></thead>
 *       <tbody>${sort.apply(rows).map(row => '...').join('')}</tbody>
 *     </table>`;
 *   container.innerHTML = tableHtml;
 *   sort.bind(container);   // wire up click handlers
 *
 * The `apply()` helper sorts a copy of the rows array using the
 * current key+dir, with a smart default value-getter that handles
 * strings (case-insensitive), numbers, dates and undefined.
 */

(function () {
    'use strict';

    function defaultGetValue(row, key) {
        if (row == null) return '';
        const v = row[key];
        if (v == null) return '';
        // Date strings: try to parse to timestamp for stable ordering.
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
            const t = Date.parse(v);
            if (!isNaN(t)) return t;
        }
        // Numeric strings ("12.50") sort numerically.
        if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) {
            return Number(v);
        }
        return typeof v === 'string' ? v.toLowerCase() : v;
    }

    function compare(a, b) {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    function create(opts) {
        opts = opts || {};
        const state = {
            key: opts.defaultKey || null,
            dir: opts.defaultDir === 'desc' ? 'desc' : 'asc',
        };
        const getValue = opts.getValue || defaultGetValue;
        const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

        function header(label, key, hOpts) {
            hOpts = hOpts || {};
            const isActive = state.key === key;
            const arrow = isActive
                ? (state.dir === 'asc' ? ' \u25b2' : ' \u25bc')
                : '';
            const align = hOpts.align ? `text-align:${hOpts.align};` : '';
            const extra = hOpts.style || '';
            return `<th class="sortable-th${isActive ? ' active' : ''}"
                        data-sort-key="${key}"
                        style="cursor:pointer;user-select:none;${align}${extra}"
                        title="Click to sort">${label}<span class="sort-arrow">${arrow}</span></th>`;
        }

        function setKey(key) {
            if (state.key === key) {
                state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                state.key = key;
                state.dir = 'asc';
            }
            if (onChange) onChange(state);
        }

        function apply(rows) {
            if (!Array.isArray(rows) || !state.key) return rows || [];
            const dir = state.dir === 'asc' ? 1 : -1;
            return [...rows].sort((a, b) => {
                const va = getValue(a, state.key);
                const vb = getValue(b, state.key);
                // Empty values always sort last regardless of dir so the
                // important rows surface at the top.
                if (va === '' && vb !== '') return 1;
                if (vb === '' && va !== '') return -1;
                return compare(va, vb) * dir;
            });
        }

        function bind(container) {
            if (!container) return;
            container.querySelectorAll('th.sortable-th[data-sort-key]').forEach(th => {
                if (th._sortableBound) return;
                th._sortableBound = true;
                th.addEventListener('click', () => setKey(th.dataset.sortKey));
            });
        }

        return {
            get key()  { return state.key; },
            get dir()  { return state.dir; },
            header, apply, bind, setKey,
        };
    }

    window.Sortable = { create };
})();
