
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { getLogs } = require('../controllers/auditController');

// All routes require Director role
router.use(auth);
router.use(authorize('director'));

router.get('/', getLogs);

module.exports = router;
