const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/pricingController');

router.post('/promotions', auth, authorize('director', 'manager'), ctrl.createPromotion);
router.get('/promotions', auth, ctrl.getActivePromotions);
router.post('/calculate', auth, ctrl.calculateCart);
router.delete('/promotions/:id', auth, authorize('director', 'manager'), ctrl.deletePromotion);

module.exports = router;
