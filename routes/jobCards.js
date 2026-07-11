const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/jobCardController');
const proofUpload = require('../middleware/proofUpload');

// Multer wrapper: pulls a single `file` field out of multipart
// requests when present, but is a no-op for legacy JSON callers
// (older Android/Windows wrappers still POST {file_url, notes}).
function maybeProofUpload(req, res, next) {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('multipart/form-data')) return next();
    proofUpload(req, res, (err) => {
        if (err) {
            const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(code).json({ error: err.message });
        }
        next();
    });
}

// Stats must be before /:id to avoid matching
router.get('/stats/pipeline', auth, ctrl.getJobStats);

router.get('/', auth, ctrl.listJobs);
router.get('/:id', auth, ctrl.getJob);
router.post('/', auth, authorize('director', 'cashier'), idempotency(), auditLog('CREATE', 'job_cards'), ctrl.createJob);
router.patch('/:id', auth, authorize('director', 'designer'), idempotency(), auditLog('UPDATE', 'job_cards'), ctrl.updateJob);
router.patch('/:id/status', auth, authorize('director', 'designer'), idempotency(), auditLog('STATUS_CHANGE', 'job_cards'), ctrl.updateJobStatus);
router.delete('/:id', auth, authorize('director'), idempotency(), auditLog('DELETE', 'job_cards'), ctrl.deleteJob);

// Proofs
router.post('/:id/proofs', auth, authorize('director', 'designer'), maybeProofUpload, idempotency(), auditLog('ADD_PROOF', 'job_proofs'), ctrl.addProof);
router.get('/:id/proofs/:proofId/file', auth, authorize('director', 'designer'), ctrl.getProofFile);
router.patch('/:id/proofs/:proofId', auth, authorize('director', 'designer'), idempotency(), ctrl.updateProofStatus);

// Costs
router.post('/:id/costs', auth, authorize('director', 'designer'), idempotency(), auditLog('ADD_COST', 'job_costs'), ctrl.addCost);

module.exports = router;
