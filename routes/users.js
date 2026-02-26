
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { getUsers, createUser, updateUser, deleteUser } = require('../controllers/userController');

// All routes require Director role
router.use(auth);
router.use(authorize('director'));

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
