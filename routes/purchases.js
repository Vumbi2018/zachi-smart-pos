const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/purchaseController');

router.get('/', auth, authorize('director'), ctrl.listPOs);
router.get('/:id', auth, authorize('director'), ctrl.getPO);
router.post('/', auth, authorize('director'), auditLog('CREATE', 'purchase_orders'), ctrl.createPO);
router.post('/:id/receive', auth, authorize('director'), auditLog('GOODS_RECEIVED', 'goods_received'), ctrl.receiveGoods);
router.put('/:id', auth, authorize('director'), auditLog('UPDATE', 'purchase_orders'), ctrl.updatePO);
router.delete('/:id', auth, authorize('director'), auditLog('DELETE', 'purchase_orders'), ctrl.deletePO);

module.exports = router;
