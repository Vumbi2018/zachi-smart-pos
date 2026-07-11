const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const requirePermission = require('../middleware/requirePermission');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
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
// Product writes are gated on the per-user `inventory.*` permissions so
// a director can grant 'manage inventory' to a specific cashier or
// designer without changing role defaults. Director short-circuits
// inside requirePermission(); the role list is defence-in-depth.
// `inventory.update` is the single "manage stock" gate for create +
// update + adjust, matching the Task #56 acceptance contract: a
// director who grants a cashier `inventory.update` can immediately
// add, edit and adjust products. Delete is intentionally separate
// (`inventory.delete`) so destructive grants stay opt-in.
router.post('/', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.update'), idempotency(), auditLog('CREATE', 'products'), ctrl.createProduct);
router.put('/:id', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.update'), idempotency(), auditLog('UPDATE', 'products'), ctrl.updateProduct);
router.delete('/:id', auth, authorize('director', 'manager', 'cashier', 'designer'), requirePermission('inventory.delete'), idempotency(), auditLog('DELETE', 'products'), ctrl.deleteProduct);


// Bulk Operations (Director only)
router.get('/import-template', auth, authorize('director'), ctrl.getImportTemplate);
// /import is a multipart upload — body is a binary file we don't fingerprint, so
// idempotency middleware (which hashes the JSON body) is not applied here.
router.post('/import', auth, authorize('director'), upload.single('file'), auditLog('IMPORT', 'products'), ctrl.importProducts);
router.get('/export', auth, authorize('director'), auditLog('EXPORT', 'products'), ctrl.exportProducts);
router.post('/bulk-delete', auth, authorize('director'), idempotency(), auditLog('BULK_DELETE', 'products'), ctrl.bulkDelete);
router.post('/bulk-update', auth, authorize('director'), idempotency(), auditLog('BULK_UPDATE', 'products'), ctrl.bulkUpdate);

// Duplicate detection & merge (Director only)
router.get('/duplicates', auth, authorize('director'), ctrl.getDuplicates);
router.post('/merge', auth, authorize('director'), idempotency(), auditLog('MERGE', 'products'), ctrl.mergeProducts);

// Specific ID Routes (Must be last to avoid catching sub-routes)
router.get('/:id', auth, ctrl.getProduct);

module.exports = router;
