const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/paymentController');
const authenticateToken = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');

router.use(authenticateToken);

router.get('/', PaymentController.getAllMethods);
router.post('/', idempotency(), PaymentController.createMethod);
router.put('/:id', idempotency(), PaymentController.updateMethod);
router.delete('/:id', idempotency(), PaymentController.deleteMethod);

module.exports = router;
