const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const requirePermission = require('../middleware/requirePermission');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/salesController');
const pdfCtrl = require('../controllers/receiptPdfController');

// Cashier, Designer, Manager and Director may all create sales — the
// per-user `sale.create` permission is the real gate (Director short-
// circuits inside requirePermission). The `designer` role does NOT have
// sale.create by default; a director toggles it on per user under
// Users → Access. Pattern mirrors routes/invoices.js.
// idempotency() must run *before* the controller so a duplicate replay
// hits the cache and never re-executes the BEGIN/COMMIT block.
router.post('/', auth, authorize('cashier', 'designer', 'manager', 'director'), requirePermission('sale.create'), idempotency(), auditLog('CREATE', 'sales'), ctrl.createSale);

// Lookup any sale by sale_number — used by the Daily Sales "Sale #" box
// to jump to a historical sale regardless of the current date filter.
// Director-only because it shadows the listSales gate.
router.get('/lookup', auth, authorize('director'), ctrl.lookupSale);

// Credit orders — outstanding balances & installment payments
router.get('/credit', auth, authorize('director', 'manager'), ctrl.getCreditOrders);
router.post('/:id/payment', auth, authorize('director', 'manager'), idempotency(), auditLog('CREDIT_PAYMENT', 'sales'), ctrl.recordCreditPayment);

// List and view sales
router.get('/', auth, authorize('director'), ctrl.listSales);
router.get('/:id', auth, authorize('cashier', 'director'), ctrl.getSale);

// PDF receipt — public via signed token (?token=&exp=) so customers
// can download from a WhatsApp link without logging in. When no token
// is supplied the route falls back to standard auth + RBAC so only
// cashiers/managers/directors can download arbitrary receipts.
router.get('/:id/receipt.pdf', (req, res, next) => {
    if (req.query.token && req.query.exp) return pdfCtrl.getReceiptPdf(req, res);
    return auth(req, res, () => {
        return authorize('cashier', 'manager', 'director')(req, res, () => {
            return pdfCtrl.getReceiptPdf(req, res);
        });
    });
});

// Mint a signed, time-limited public URL the cashier can paste into
// WhatsApp/SMS. Authenticated cashiers/managers/directors only.
router.get('/:id/receipt-link', auth, authorize('cashier', 'manager', 'director'), pdfCtrl.getReceiptLink);

// Void sale (Director only)
router.patch('/:id/void', auth, authorize('director'), idempotency(), auditLog('VOID_SALE', 'sales'), ctrl.voidSale);

// Hard-delete sale (Director only). Restores stock if not already voided
// and removes child rows in sale_items / sale_payments / cash_movements
// / credit_payments / loyalty_transactions.
router.delete('/:id', auth, authorize('director'), idempotency(), auditLog('DELETE_SALE', 'sales'), ctrl.deleteSale);
// v1.0.31 (Task #57) — Director-only per-line refund. Soft-marks one
// sale_items row as removed_at, restores stock, recomputes totals,
// shrinks the largest tender by the removed gross, and posts a
// negative cash_movements row for any cash leg shrunk.
router.delete('/:id/items/:itemId', auth, authorize('director'), idempotency(), auditLog('REMOVE_SALE_ITEM', 'sales'), ctrl.removeSaleItem);

// Email Receipt
router.post('/receipt/email', auth, idempotency(), ctrl.emailReceipt);

// Backlog sales entry (Director only — allows historical transaction_date + skip_stock_adjustment)
router.post('/backlog', auth, authorize('director'), idempotency(), auditLog('BACKLOG_SALE', 'sales'), ctrl.createSale);
router.post('/backlog/bulk', auth, authorize('director'), idempotency(), auditLog('BACKLOG_BULK', 'sales'), ctrl.createBacklogBulk);

module.exports = router;
