const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/supplierController');

router.get('/', auth, authorize('director', 'manager'), ctrl.listSuppliers);
router.get('/:id', auth, authorize('director', 'manager'), ctrl.getSupplier);
router.post('/', auth, authorize('director'), idempotency(), auditLog('CREATE', 'suppliers'), ctrl.createSupplier);
router.put('/:id', auth, authorize('director'), idempotency(), auditLog('UPDATE', 'suppliers'), ctrl.updateSupplier);
router.delete('/:id', auth, authorize('director'), idempotency(), auditLog('DELETE', 'suppliers'), ctrl.deleteSupplier);
router.post('/:id/prices', auth, authorize('director'), idempotency(), auditLog('UPDATE', 'supplier_prices'), ctrl.addPriceList);
router.delete('/:id/prices/:productId', auth, authorize('director'), idempotency(), auditLog('DELETE', 'supplier_prices'), ctrl.removePriceList);

module.exports = router;
