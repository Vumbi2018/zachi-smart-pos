const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/deviceController');

// Every authenticated install registers itself once on first launch.
// Cashier and director both need this — anyone who can sign in can sync.
router.post('/register', auth, ctrl.register);

// Director-only: see who is syncing from where, and when.
router.get('/', auth, authorize('director'), ctrl.list);

module.exports = router;
