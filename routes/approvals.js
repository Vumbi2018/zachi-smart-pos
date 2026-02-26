const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/approvalController');

router.use(auth);

// Any authenticated user can create a request (depending on UI logic, maybe restrict/harden later)
router.post('/', ctrl.createApproval);

// Only Directors can view and decide
router.get('/', authorize('director'), ctrl.listApprovals);
router.post('/:id/decide', authorize('director'), ctrl.decideApproval);

module.exports = router;
