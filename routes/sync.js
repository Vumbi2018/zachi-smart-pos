const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/syncController');

// Both sides of the sync protocol require an authenticated user — the
// JWT identifies who (and via X-Device-Id, which install) is syncing.
router.post('/push', auth, ctrl.push);
router.get('/pull', auth, ctrl.pull);

module.exports = router;
