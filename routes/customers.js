const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/customerController');

const upload = require('../middleware/upload');

router.get('/', auth, ctrl.listCustomers);
router.get('/export', auth, authorize('director', 'manager'), ctrl.exportCustomers);
router.get('/import-template', auth, ctrl.getImportTemplate);
router.get('/:id', auth, ctrl.getCustomer);
router.post('/', auth, authorize('cashier', 'director', 'consultant'), idempotency(), ctrl.createCustomer);
router.post('/import', auth, authorize('director', 'manager'), upload.single('file'), ctrl.importCustomers);
router.put('/:id', auth, authorize('director', 'consultant'), idempotency(), ctrl.updateCustomer);

module.exports = router;
