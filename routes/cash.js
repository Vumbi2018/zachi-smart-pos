const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/cashController');

router.get('/current', auth, ctrl.getCurrentSession);
router.get('/history', auth, authorize('director'), ctrl.sessionHistory);
router.get('/history/:id', auth, ctrl.getSessionMovements);
router.get('/eod/:id', auth, authorize('director'), ctrl.getEodReport);
router.post('/open', auth, authorize('director', 'cashier'), auditLog('CASH_OPEN', 'cash_sessions'), ctrl.openSession);
router.post('/close', auth, authorize('director', 'cashier'), auditLog('CASH_CLOSE', 'cash_sessions'), ctrl.closeSession);
router.post('/paid-in', auth, authorize('director', 'cashier'), auditLog('CASH_PAID_IN', 'cash_movements'), ctrl.paidIn);
router.post('/paid-out', auth, authorize('director', 'cashier'), auditLog('CASH_PAID_OUT', 'cash_movements'), ctrl.paidOut);

module.exports = router;
