const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
let token = '';

async function verify() {
    try {
        console.log('🔄 Logging in as Director...');
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            username: 'director',
            password: 'admin123'
        });
        token = loginRes.data.token;
        console.log('✅ Login successful.');

        console.log('🔄 Fetching Services...');
        const servicesRes = await axios.get(`${BASE_URL}/services`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const service = servicesRes.data.services[0];
        if (!service) throw new Error('No services found');
        console.log(`✅ Found service: ${service.service_name}`);

        console.log('🔄 Fetching Payment Methods...');
        const methodsRes = await axios.get(`${BASE_URL}/payments`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const methods = methodsRes.data;
        console.log(`✅ Fetched ${methods.length} payment methods.`);

        // Find "Airtel Money" or just use non-cash
        const method = methods.find(m => m.type !== 'cash') || methods[0];
        console.log(`👉 Using method: ${method.name}`);

        console.log('🔄 Creating Sale with Reference...');
        const salePayload = {
            items: [{ type: 'service', service_id: service.service_id, quantity: 1 }],
            payment_method: method.name,
            amount_paid: parseFloat(service.base_price),
            payment_reference: 'TX-VERIFY-999'
        };

        const saleRes = await axios.post(`${BASE_URL}/sales`, salePayload, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const sale = saleRes.data;
        console.log(`✅ Sale created: ${sale.sale_number}`);

        if (sale.payment_reference === 'TX-VERIFY-999') {
            console.log('✅ Payment Reference verified in response.');
        } else {
            console.error('❌ Payment Reference mismatch in response:', sale.payment_reference);
        }

        // Verify persistence by fetching
        console.log('🔄 Fetching Sale to verify persistence...');
        const fetchRes = await axios.get(`${BASE_URL}/sales/${sale.sale_id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (fetchRes.data.payment_reference === 'TX-VERIFY-999') {
            console.log('🎉 Verification SUCCESS! Payment Reference persisted.');
        } else {
            console.error('❌ Verification FAILED: Persistence check failed.');
        }

    } catch (err) {
        console.error('❌ Verification Error:', err.response ? err.response.data : err.message);
    }
}

verify();
