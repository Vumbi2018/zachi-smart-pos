const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/salesController');

// Cashier and Director can create sales
router.post('/', auth, authorize('cashier', 'director'), auditLog('CREATE', 'sales'), ctrl.createSale);

// List and view sales
router.get('/', auth, authorize('director'), ctrl.listSales);
router.get('/:id', auth, authorize('cashier', 'director'), ctrl.getSale);

// Void sale (Director only)
router.patch('/:id/void', auth, authorize('director'), auditLog('VOID_SALE', 'sales'), ctrl.voidSale);

// Email Receipt
router.post('/receipt/email', auth, ctrl.emailReceipt);

module.exports = router;
