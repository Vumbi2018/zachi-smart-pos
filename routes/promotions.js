const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/pricingController');

router.get('/', auth, ctrl.getActivePromotions);
router.post('/', auth, authorize('director', 'manager'), idempotency(), ctrl.createPromotion);
router.delete('/:id', auth, authorize('director', 'manager'), idempotency(), ctrl.deletePromotion);

module.exports = router;