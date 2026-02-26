const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/settingsController');

// All settings routes require authentication

// GET /api/settings - Get all settings (Public to authenticated users for frontend config)
router.get('/', auth, ctrl.getSettings);

// PUT /api/settings/:key - Update a setting (Director/Admin only)
router.put('/:key', auth, authorize('director'), auditLog('UPDATE_SETTING', 'system_settings'), ctrl.updateSetting);

module.exports = router;
