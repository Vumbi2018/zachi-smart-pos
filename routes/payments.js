const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/paymentController');
const authenticateToken = require('../middleware/auth');

router.use(authenticateToken);

router.get('/', PaymentController.getAllMethods);
router.post('/', PaymentController.createMethod);
router.put('/:id', PaymentController.updateMethod);
router.delete('/:id', PaymentController.deleteMethod);

module.exports = router;
