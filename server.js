const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const app = express();

// Trust Nginx reverse proxy (required for correct IP, HTTPS detection on Hostinger)
app.set('trust proxy', 1);

// =====================================================
// Middleware
// =====================================================
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: allow localhost in dev, restrict to production domain online
const allowedOrigins = [
    'http://localhost:5000',
    'http://localhost:3000',
    process.env.CORS_ORIGIN || '*' // Set CORS_ORIGIN=https://yourdomain.com in production .env
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS blocked: ${origin}`));
        }
    },
    credentials: true
}));

// Use 'combined' format in production for proper Nginx-compatible access logs
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging (Diagnostic)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('index.html')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
    }
}));

// =====================================================
// API Routes
// =====================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/services', require('./routes/services'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/users', require('./routes/users'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));
app.get('/api/currency', require('./controllers/currencyController').getRates);

// Enterprise modules
app.use('/api/jobs', require('./routes/jobCards'));
app.use('/api/cash', require('./routes/cash'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/approvals', require('./routes/approvals'));

// =====================================================
// Health Check
// =====================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', name: 'Zachi Smart-POS', version: '1.0.0' });
});

// =====================================================
// SPA Fallback — serve index.html for all non-API routes
// =====================================================
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: `API Endpoint not found: ${req.method} ${req.path}` });
    }

    // Only serve index.html for GET requests, otherwise 404
    if (req.method === 'GET') {
        res.sendFile('index.html', { root: path.join(__dirname, 'public') }, (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).send(err.message);
            }
        });
    } else {
        res.status(404).send('Not Found');
    }
});

// =====================================================
// Error Handler
// =====================================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// =====================================================
// Start Server
// =====================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║     🏪 Zachi Smart-POS v1.0.0           ║
  ║     Running on http://localhost:${PORT}      ║
  ║     Environment: ${process.env.NODE_ENV || 'development'}          ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
