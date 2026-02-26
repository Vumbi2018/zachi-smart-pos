const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/loyaltyController');

router.get('/tiers', auth, ctrl.listTiers);
router.get('/customer/:id', auth, ctrl.getCustomerLoyalty);
router.get('/credits/:customerId', auth, ctrl.getStoreCredits);
router.post('/earn', auth, authorize('director', 'cashier'), ctrl.earnPoints);
router.post('/redeem', auth, authorize('director', 'cashier'), ctrl.redeemPoints);
router.post('/tiers', auth, authorize('director'), ctrl.manageTiers);

module.exports = router;
