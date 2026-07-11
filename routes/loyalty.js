const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/loyaltyController');

router.get('/tiers', auth, ctrl.listTiers);
router.get('/customer/:id', auth, ctrl.getCustomerLoyalty);
router.get('/credits/:customerId', auth, ctrl.getStoreCredits);
router.post('/earn', auth, authorize('director', 'cashier'), idempotency(), ctrl.earnPoints);
router.post('/redeem', auth, authorize('director', 'cashier'), idempotency(), ctrl.redeemPoints);
router.post('/tiers', auth, authorize('director'), idempotency(), ctrl.manageTiers);

module.exports = router;
