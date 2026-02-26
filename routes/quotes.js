const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/quoteController');

router.get('/', auth, ctrl.listQuotes);
router.get('/:id', auth, ctrl.getQuote);
router.post('/', auth, authorize('director', 'cashier'), auditLog('CREATE', 'quotes'), ctrl.createQuote);
router.patch('/:id/status', auth, authorize('director'), auditLog('STATUS_CHANGE', 'quotes'), ctrl.updateQuoteStatus);
router.post('/:id/convert', auth, authorize('director', 'cashier'), auditLog('CONVERT_QUOTE', 'quotes'), ctrl.convertToSale);

module.exports = router;
