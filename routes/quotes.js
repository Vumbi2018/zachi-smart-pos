const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/quoteController');
const pdfCtrl = require('../controllers/quotePdfController');

// Signed-URL PDF download — no auth when ?token+exp are present, otherwise
// fall through to standard auth (mirrors routes/sales.js receipt PDF route).
router.get('/:id/quote.pdf', (req, res, next) => {
    if (req.query.token && req.query.exp) return pdfCtrl.getQuotePdf(req, res);
    return auth(req, res, () => pdfCtrl.getQuotePdf(req, res));
});
router.get('/:id/quote-link', auth, authorize('director', 'cashier', 'manager'), pdfCtrl.getQuoteLink);

router.get('/', auth, ctrl.listQuotes);
router.get('/:id', auth, ctrl.getQuote);
router.post('/', auth, authorize('director', 'cashier'), idempotency(), auditLog('CREATE', 'quotes'), ctrl.createQuote);
router.put('/:id', auth, authorize('director', 'cashier', 'manager'), idempotency(), auditLog('UPDATE', 'quotes'), ctrl.updateQuote);
router.patch('/:id/status', auth, authorize('director', 'cashier', 'manager'), idempotency(), auditLog('STATUS_CHANGE', 'quotes'), ctrl.updateQuoteStatus);
router.post('/:id/convert', auth, authorize('director', 'cashier'), idempotency(), auditLog('CONVERT_QUOTE', 'quotes'), ctrl.convertToSale);
router.post('/:id/email', auth, authorize('director', 'cashier', 'manager'), idempotency(), auditLog('EMAIL', 'quotes'), ctrl.emailQuote);

module.exports = router;
