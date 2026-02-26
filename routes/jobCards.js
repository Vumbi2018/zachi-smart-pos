const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const auditLog = require('../middleware/audit');
const ctrl = require('../controllers/jobCardController');

// Stats must be before /:id to avoid matching
router.get('/stats/pipeline', auth, ctrl.getJobStats);

router.get('/', auth, ctrl.listJobs);
router.get('/:id', auth, ctrl.getJob);
router.post('/', auth, authorize('director', 'cashier'), auditLog('CREATE', 'job_cards'), ctrl.createJob);
router.patch('/:id', auth, authorize('director', 'designer'), auditLog('UPDATE', 'job_cards'), ctrl.updateJob);
router.patch('/:id/status', auth, authorize('director', 'designer'), auditLog('STATUS_CHANGE', 'job_cards'), ctrl.updateJobStatus);
router.delete('/:id', auth, authorize('director'), auditLog('DELETE', 'job_cards'), ctrl.deleteJob);

// Proofs
router.post('/:id/proofs', auth, authorize('director', 'designer'), auditLog('ADD_PROOF', 'job_proofs'), ctrl.addProof);
router.patch('/:id/proofs/:proofId', auth, authorize('director', 'designer'), ctrl.updateProofStatus);

// Costs
router.post('/:id/costs', auth, authorize('director', 'designer'), auditLog('ADD_COST', 'job_costs'), ctrl.addCost);

module.exports = router;
