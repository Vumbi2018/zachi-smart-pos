const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/approvalController');

router.use(auth);

// Any authenticated user can create an approval request; UI gates which roles see the form.
router.post('/', idempotency(), ctrl.createApproval);

// Only Directors can view and decide
router.get('/', authorize('director'), ctrl.listApprovals);
router.post('/:id/decide', authorize('director'), idempotency(), ctrl.decideApproval);

module.exports = router;
