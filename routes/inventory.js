const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const requirePermission = require('../middleware/requirePermission');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/inventoryController');

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Reads stay broadly available — every staff role needs to see stock.
router.get('/', auth, authorize('director', 'manager', 'cashier', 'designer'), ctrl.getInventory);
router.get('/:id/movements', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.view'), ctrl.getMovements);

// Stock-receiving and adjustment write paths now check per-user
// overrides so a director can grant 'inventory.update' to a specific
// cashier/designer without changing role defaults. The role list is
// widened only as a coarse defence-in-depth filter — the real gate is
// requirePermission() (director short-circuits there).
router.get('/stocktake/export', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.export'), ctrl.exportStocktake);
router.post('/stocktake/upload', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.import'), upload.single('file'), ctrl.uploadStocktake);
router.post('/quick-receive/upload', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.import'), upload.single('file'), ctrl.uploadStockReceiving);

router.post('/adjust', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.update'), idempotency(), auditLog('ADJUST_STOCK', 'inventory'), ctrl.adjustStock);
router.post('/stocktake', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.update'), idempotency(), auditLog('STOCKTAKE', 'inventory'), ctrl.saveStocktake);
router.post('/quick-receive', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.update'), idempotency(), auditLog('STOCK_RECEIVING', 'inventory'), ctrl.quickReceive);

module.exports = router;
