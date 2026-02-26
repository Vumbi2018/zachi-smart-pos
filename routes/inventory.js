const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/inventoryController');

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', auth, authorize('director', 'manager', 'cashier'), ctrl.getInventory);
router.get('/:id/movements', auth, authorize('director', 'manager'), ctrl.getMovements);
// Import/Export
router.get('/stocktake/export', auth, authorize('director', 'manager'), ctrl.exportStocktake);
router.post('/stocktake/upload', auth, authorize('director', 'manager'), upload.single('file'), ctrl.uploadStocktake);
router.post('/quick-receive/upload', auth, authorize('director', 'manager'), upload.single('file'), ctrl.uploadStockReceiving);

router.post('/adjust', auth, authorize('director', 'manager'), auditLog('ADJUST_STOCK', 'inventory'), ctrl.adjustStock);
router.post('/stocktake', auth, authorize('director'), auditLog('STOCKTAKE', 'inventory'), ctrl.saveStocktake);
router.post('/quick-receive', auth, authorize('director', 'manager'), auditLog('STOCK_RECEIVING', 'inventory'), ctrl.quickReceive);

module.exports = router;
