'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const requirePermission = require('../middleware/requirePermission');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/invoiceController');

// Signed-URL PDF download — no auth when ?token+exp present, otherwise
// fall through to standard auth+RBAC like the receipt PDF route does.
// `invoice.view` is gated per-user so a manager who has been denied
// invoice.view can't pull PDFs even though their role would allow it.
router.get('/:id/invoice.pdf', (req, res, next) => {
    if (req.query.token && req.query.exp) return ctrl.getInvoicePdf(req, res);
    return auth(req, res, () => {
        return authorize('cashier', 'manager', 'director')(req, res, () => {
            return requirePermission('invoice.view')(req, res, () => {
                return ctrl.getInvoicePdf(req, res);
            });
        });
    });
});

// Mint a signed, time-limited public URL the cashier can drop into
// WhatsApp/SMS. Per-user `invoice.send` gates this — revoking it on
// a single cashier disables only their ability to mint customer links.
router.get('/:id/invoice-link', auth, authorize('cashier', 'manager', 'director'),
    requirePermission('invoice.send'), ctrl.getInvoiceLink);

// Everything else needs auth.
router.use(auth);

// All invoice routes are gated by BOTH the legacy role check AND the
// new per-user permission resolver. Role check stays for defence in
// depth + so legacy clients see the same 403 reason; requirePermission
// is what actually consults user_permissions overrides. Director is
// short-circuited inside requirePermission, so removing every override
// from a non-director user is the only way to escalate beyond defaults.
router.get('/',             authorize('cashier', 'manager', 'director'), requirePermission('invoice.view'),   ctrl.listInvoices);
router.get('/:id',          authorize('cashier', 'manager', 'director'), requirePermission('invoice.view'),   ctrl.getInvoice);
// Manual invoice creation is open to director + manager — same set as
// role_permissions seeds invoice.create to in migration 019. The actual
// gate is requirePermission('invoice.create'), which honours per-user
// overrides; the role check stays for defence in depth.
router.post('/',            authorize('director', 'manager'),            requirePermission('invoice.create'), idempotency(), auditLog('CREATE', 'invoices'), ctrl.createInvoice);
router.put('/:id',          authorize('director', 'manager'),            requirePermission('invoice.update'), idempotency(), auditLog('UPDATE', 'invoices'), ctrl.updateInvoice);
router.patch('/:id/status', authorize('director', 'manager'),            requirePermission('invoice.update'), idempotency(), auditLog('STATUS_CHANGE', 'invoices'), ctrl.updateInvoiceStatus);
router.post('/:id/payment', authorize('director', 'manager', 'cashier'), requirePermission('invoice.pay'),    idempotency(), auditLog('INVOICE_PAYMENT', 'invoices'), ctrl.recordPayment);
router.post('/:id/email',   authorize('director', 'manager', 'cashier'), requirePermission('invoice.send'),   idempotency(), auditLog('EMAIL', 'invoices'), ctrl.emailInvoice);

module.exports = router;
