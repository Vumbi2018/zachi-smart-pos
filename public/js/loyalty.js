const Loyalty = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Loyalty Program</h1>
                    <p class="text-secondary">Manage customer loyalty tiers and rewards.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Tiers List -->
                <div class="card p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="card-title">Loyalty Tiers</h2>
                        <button class="btn btn-sm btn-primary" onclick="Loyalty.addTierRow()">+ Add Tier</button>
                    </div>
                    <form id="tiers-form">
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="text-xs uppercase text-secondary border-b">
                                        <th class="py-2">Tier Name</th>
                                        <th class="py-2">Min. Points</th>
                                        <th class="py-2">Discount %</th>
                                        <th class="py-2">Multiplier</th>
                                        <th class="py-2 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody id="tiers-tbody">
                                    <tr><td colspan="5" class="text-center py-4">Loading...</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="mt-4 flex justify-end">
                            <button type="button" class="btn btn-primary" onclick="Loyalty.saveTiers()">Save Changes</button>
                        </div>
                    </form>
                </div>

                <!-- Simulation / Calculator (Optional future feature) -->
                <div class="card p-6 bg-gradient text-white">
                     <h2 class="font-bold text-lg mb-2">How it works</h2>
                     <ul class="list-disc pl-5 space-y-2 text-sm">
                        <li>Customers earn points based on purchase amount (default 1 point per K1).</li>
                        <li><strong>Multiplier:</strong> 1.5x means earning 1.5 points per K1.</li>
                        <li><strong>Discount %:</strong> Automatic discount applied to sales for customers in this tier.</li>
                        <li>Tiers are assigned automatically when a customer reaches the <strong>Min. Points</strong> threshold.</li>
                     </ul>
                </div>
            </div>
        `;

        this.loadTiers();
    },

    async loadTiers() {
        try {
            const tiers = await API.get('/loyalty/tiers');
            this.renderTiersTable(tiers);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load tiers', 'error');
        }
    },

    renderTiersTable(tiers) {
        const tbody = document.getElementById('tiers-tbody');
        if (tiers.length === 0) {
            this.addTierRow(true); // Add empty row if none
            return;
        }

        tbody.innerHTML = tiers.map(t => this.getTierRowHtml(t)).join('');
    },

    getTierRowHtml(tier = {}) {
        return `
            <tr class="border-b last:border-0 tier-row">
                <td class="py-2 pr-2">
                    <input type="hidden" name="tier_id" value="${tier.tier_id || ''}">
                    <input type="text" name="name" class="form-input text-sm" value="${tier.name || ''}" placeholder="e.g. Silver" required>
                </td>
                <td class="py-2 pr-2">
                    <input type="number" name="min_points" class="form-input text-sm" value="${tier.min_points || 0}" required min="0">
                </td>
                <td class="py-2 pr-2">
                    <input type="number" name="discount_pct" class="form-input text-sm" value="${tier.discount_pct || 0}" step="0.1" min="0" max="100">
                </td>
                <td class="py-2 pr-2">
                    <input type="number" name="points_multiplier" class="form-input text-sm" value="${tier.points_multiplier || 1.0}" step="0.1" min="1">
                </td>
                <td class="py-2 text-right">
                    <button type="button" class="text-red-500 hover:text-red-700" onclick="this.closest('tr').remove()">✕</button>
                </td>
            </tr>
        `;
    },

    addTierRow(clear = false) {
        const tbody = document.getElementById('tiers-tbody');
        if (clear) tbody.innerHTML = '';
        tbody.insertAdjacentHTML('beforeend', this.getTierRowHtml());
    },

    async saveTiers() {
        const rows = document.querySelectorAll('.tier-row');
        const tiers = [];

        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            const tier = {};
            inputs.forEach(input => {
                if (input.value) tier[input.name] = input.type === 'number' ? parseFloat(input.value) : input.value;
            });
            if (tier.name) tiers.push(tier);
        });

        try {
            await API.post('/loyalty/tiers', { tiers });
            Utils.toast('Loyalty tiers updated!', 'success');
            this.loadTiers();
        } catch (err) {
            Utils.toast(err.message || 'Failed to save tiers', 'error');
        }
    }
};
