/**
 * Variable Pricing Engine
 * Handles volume discounts, material pricing, and labor calculations
 */

// Volume discount tiers
const VOLUME_DISCOUNTS = [
    { min: 500, discount: 0.15 },  // 500+ pages: 15% off
    { min: 200, discount: 0.10 },  // 200+ pages: 10% off
    { min: 100, discount: 0.05 },  // 100+ pages: 5% off
];

// Material multipliers
const MATERIAL_MULTIPLIERS = {
    'plain': 1.0,
    'glossy': 1.5,
    'cardstock': 2.0,
    'vinyl': 2.5,
    'fabric': 3.0,
};

/**
 * Calculate price for a service based on quantity and options
 * @param {Object} service - The service record from DB
 * @param {Number} quantity - Quantity (pages, hours, items)
 * @param {Object} options - Optional overrides { material, labor_hours, complexity }
 * @returns {Number} Final unit price
 */
function calculatePrice(service, quantity, options = {}) {
    let basePrice = parseFloat(service.base_price) || 0;

    // Apply material multiplier
    if (options && options.material && MATERIAL_MULTIPLIERS[options.material]) {
        basePrice *= MATERIAL_MULTIPLIERS[options.material];
    }

    // Apply volume discount (for per_page services)
    if (service.unit_measure === 'per_page' && quantity >= 100) {
        const tier = VOLUME_DISCOUNTS.find(t => quantity >= t.min);
        if (tier) {
            basePrice *= (1 - tier.discount);
        }
    }

    // Labor fee for consultancy (per_hour services)
    if (service.unit_measure === 'per_hour' && options && options.complexity) {
        const complexityMultipliers = { simple: 1.0, moderate: 1.5, complex: 2.0 };
        basePrice *= (complexityMultipliers[options.complexity] || 1.0);
    }

    return parseFloat(basePrice.toFixed(2));
}

module.exports = { calculatePrice, VOLUME_DISCOUNTS, MATERIAL_MULTIPLIERS };
