const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/aiController');

// All AI routes require director/manager level for now
router.get('/insights', auth, authorize('director', 'manager'), ctrl.getInsights);
router.get('/fraud-alerts', auth, authorize('director'), ctrl.getFraudAlerts);
router.get('/stock-alerts', auth, authorize('director', 'manager'), ctrl.getStockAlerts);
router.get('/stock-analysis', auth, authorize('director', 'manager'), ctrl.getStockAnalysis);

// LLM-backed (Claude). Director/manager only — runs server-generated SQL.
router.post('/ask', auth, authorize('director', 'manager'), ctrl.ask);
// Smart product entry suggestions — any inventory-editor role.
router.post('/suggest-product', auth, authorize('director', 'manager'), ctrl.suggestProduct);

module.exports = router;
