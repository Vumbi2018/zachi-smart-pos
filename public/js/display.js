/**
 * Zachi POS — Customer-facing display SSE client.
 *
 * Loaded by /display.html. Lives in its own file (not inline) so the
 * strict CSP (script-src 'self') will execute it in production.
 *
 * Subscribes to /api/display/stream?terminal=<id> and renders three
 * states: welcome, live cart, and a "thanks" overlay after a sale.
 */
(() => {
    const params = new URLSearchParams(location.search);
    const terminal = params.get('terminal') || 'main';
    const currency = params.get('currency') || 'K';
    const fmt = (n) => `${currency} ${(Number(n) || 0).toFixed(2)}`;

    const $ = (id) => document.getElementById(id);

    // Live clock
    setInterval(() => {
        const d = new Date();
        $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 1000);

    function renderCart(p) {
        if (!p.items || p.items.length === 0) return showWelcome();
        $('cart-view-empty').classList.add('hidden');
        $('cart-view-active').classList.remove('hidden');
        $('summary').style.display = 'flex';

        // Build the list with safe DOM nodes (textContent) instead of
        // innerHTML so any product name is rendered as data, not markup.
        const list = $('cart-list');
        list.innerHTML = '';
        for (const it of p.items) {
            const name = (it.name || it.product_name || it.service_name || 'Item').toString();
            const qty = Number(it.qty || it.quantity || 1);
            const price = Number(it.price || it.unit_price || 0);
            const lineTotal = Number(it.line_total != null ? it.line_total : qty * price);

            const row = document.createElement('div');
            row.className = 'cart-item';

            const nameEl = document.createElement('div');
            nameEl.className = 'name';
            nameEl.textContent = name;

            const qtyEl = document.createElement('div');
            qtyEl.className = 'qty';
            qtyEl.textContent = `${qty} × ${fmt(price)}`;

            const totEl = document.createElement('div');
            totEl.className = 'line-total';
            totEl.textContent = fmt(lineTotal);

            row.appendChild(nameEl);
            row.appendChild(qtyEl);
            row.appendChild(totEl);
            list.appendChild(row);
        }

        $('sum-subtotal').textContent = fmt(p.subtotal);
        $('sum-discount').textContent = fmt(p.discount);
        $('sum-tax').textContent = fmt(p.tax);
        $('sum-total').textContent = fmt(p.total);

        if (p.customer && p.customer.name) {
            $('cust-line').textContent = `Customer: ${p.customer.name}`;
            $('cust-line').classList.remove('hidden');
        } else {
            $('cust-line').classList.add('hidden');
        }
        $('cashier-line').textContent = p.cashier ? `Served by ${p.cashier}` : '';
    }

    function showWelcome() {
        $('cart-view-empty').classList.remove('hidden');
        $('cart-view-active').classList.add('hidden');
        $('summary').style.display = 'none';
        $('thanks').classList.add('hidden');
    }

    function showThanks(p) {
        const el = $('thanks-change');
        el.innerHTML = '';
        const label = document.createElement('span');
        label.textContent = p.change > 0 ? 'Your change' : 'Total paid';
        const amount = document.createElement('strong');
        amount.textContent = fmt(p.change > 0 ? p.change : p.total);
        el.appendChild(label);
        el.appendChild(amount);

        $('thanks').classList.remove('hidden');
        setTimeout(() => {
            $('thanks').classList.add('hidden');
            showWelcome();
        }, 6000);
    }

    let es = null;
    function connect() {
        es = new EventSource(`/api/display/stream?terminal=${encodeURIComponent(terminal)}`);
        es.addEventListener('cart', (e) => renderCart(JSON.parse(e.data)));
        es.addEventListener('welcome', () => showWelcome());
        es.addEventListener('thanks', (e) => showThanks(JSON.parse(e.data)));
        es.onopen = () => $('conn-dot').classList.remove('off');
        es.onerror = () => {
            $('conn-dot').classList.add('off');
            // EventSource auto-reconnects; close + reopen on stuck states
            try { es.close(); } catch (_) { }
            setTimeout(connect, 3000);
        };
    }
    connect();
})();
