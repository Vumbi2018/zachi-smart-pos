const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/productController');

// Public read routes (any authenticated user)
router.get('/', auth, ctrl.listProducts);
router.get('/categories', auth, ctrl.getCategories);
router.get('/alerts/low-stock', auth, authorize('director'), ctrl.lowStockAlerts);
router.get('/barcode/:code', auth, ctrl.getByBarcode);
// This wildcard route must be LAST
// This wildcard route moved to end

// Director-only write routes
router.post('/', auth, authorize('director'), auditLog('CREATE', 'products'), ctrl.createProduct);
router.put('/:id', auth, authorize('director'), auditLog('UPDATE', 'products'), ctrl.updateProduct);
router.delete('/:id', auth, authorize('director'), auditLog('DELETE', 'products'), ctrl.deleteProduct);


// Bulk Operations (Director only)
router.get('/import-template', auth, authorize('director'), ctrl.getImportTemplate);
router.post('/import', auth, authorize('director'), upload.single('file'), auditLog('IMPORT', 'products'), ctrl.importProducts);
router.get('/export', auth, authorize('director'), auditLog('EXPORT', 'products'), ctrl.exportProducts);
router.post('/bulk-delete', auth, authorize('director'), auditLog('BULK_DELETE', 'products'), ctrl.bulkDelete);
router.post('/bulk-update', auth, authorize('director'), auditLog('BULK_UPDATE', 'products'), ctrl.bulkUpdate);

// Specific ID Routes (Must be last to avoid catching sub-routes)
router.get('/:id', auth, ctrl.getProduct);

module.exports = router;
