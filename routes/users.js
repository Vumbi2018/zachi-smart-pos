const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const idempotency = require('../middleware/idempotency');
const {
    getUsers,
    getUserById,
    getUserPermissions,
    createUser,
    updateUser,
    deleteUser,
} = require('../controllers/userController');

// All routes require Director role
router.use(auth);
router.use(authorize('director'));

router.get('/', getUsers);
router.post('/', idempotency(), createUser);
router.get('/:id', getUserById);
router.get('/:id/permissions', getUserPermissions);
router.put('/:id', idempotency(), updateUser);
router.delete('/:id', idempotency(), deleteUser);

module.exports = router;
