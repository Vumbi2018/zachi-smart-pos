const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const {
    login,
    register,
    getProfile,
    getMyPermissions,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
} = require('../controllers/authController');

// Public
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected
router.post('/register', auth, authorize('director'), register);
router.get('/me', auth, getProfile);
router.get('/me/permissions', auth, getMyPermissions);
router.put('/me', auth, updateProfile);
router.post('/me/password', auth, changePassword);

module.exports = router;
