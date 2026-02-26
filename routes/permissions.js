const express = require('express');
const router = express.Router();
const PermissionController = require('../controllers/permissionController');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/rbac');

// All routes require Director access
router.use(authenticateToken);
router.use(authorize('director'));

// Get all available permissions definition
router.get('/', PermissionController.getAllPermissions);

// Get current assignment matrix
router.get('/matrix', PermissionController.getRolePermissions);

// Update permissions for a specific role
router.put('/role/:role', PermissionController.updateRolePermissions);

module.exports = router;
