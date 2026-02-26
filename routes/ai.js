const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/aiController');

// All AI routes require director/manager level for now
router.get('/insights', auth, authorize('director', 'manager'), ctrl.getInsights);
router.get('/fraud-alerts', auth, authorize('director'), ctrl.getFraudAlerts);

module.exports = router;
