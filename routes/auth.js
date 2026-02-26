const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { login, register, getProfile } = require('../controllers/authController');

// Public
router.post('/login', login);

// Protected
router.post('/register', auth, authorize('director'), register);
router.get('/me', auth, getProfile);

module.exports = router;
