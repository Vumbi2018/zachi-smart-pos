const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/serviceController');

router.get('/', auth, ctrl.listServices);
router.get('/categories', auth, ctrl.getCategories);
router.post('/', auth, authorize('director'), idempotency(), ctrl.createService);
router.put('/:id', auth, authorize('director'), idempotency(), ctrl.updateService);
router.delete('/:id', auth, authorize('director'), idempotency(), ctrl.deleteService);

// Bulk actions
router.post('/bulk-delete', auth, authorize('director'), idempotency(), ctrl.bulkDeleteServices);
router.post('/bulk-update', auth, authorize('director'), idempotency(), ctrl.bulkUpdateServices);

module.exports = router;
