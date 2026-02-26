const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/returnController');

router.get('/', auth, authorize('director', 'cashier'), ctrl.listReturns);
router.get('/:id', auth, authorize('director', 'cashier'), ctrl.getReturn);
router.get('/sales/search', auth, authorize('director', 'cashier'), ctrl.findSale);
router.post('/', auth, authorize('director', 'cashier'), auditLog('CREATE', 'returns'), ctrl.createReturn);
router.patch('/:id/process', auth, authorize('director'), auditLog('PROCESS_RETURN', 'returns'), ctrl.processReturn);

module.exports = router;
