const axios = require('axios');

let ratesCache = null;
let lastFetch = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

exports.getRates = async (req, res) => {
    try {
        const now = Date.now();
        if (ratesCache && (now - lastFetch < CACHE_DURATION)) {
            return res.json(ratesCache);
        }

        // Fetch from free API
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
        const data = response.data;

        // Transform to our format if needed, or just return relevant rates
        // The API returns { base: "USD", rates: { "ZMW": 27.5, ... } }

        ratesCache = data.rates;
        lastFetch = now;

        res.json(ratesCache);
    } catch (error) {
        console.error('Error fetching exchange rates:', error.message);
        // Fallback to cache if available, even if expired
        if (ratesCache) {
            return res.json(ratesCache);
        }
        res.status(502).json({ error: 'Failed to fetch exchange rates' });
    }
};
