const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/serviceController');

router.get('/', auth, ctrl.listServices);
router.get('/categories', auth, ctrl.getCategories);
router.post('/', auth, authorize('director'), ctrl.createService);
router.put('/:id', auth, authorize('director'), ctrl.updateService);
router.delete('/:id', auth, authorize('director'), ctrl.deleteService);

// Bulk actions
router.post('/bulk-delete', auth, authorize('director'), ctrl.bulkDeleteServices);
router.post('/bulk-update', auth, authorize('director'), ctrl.bulkUpdateServices);

module.exports = router;
