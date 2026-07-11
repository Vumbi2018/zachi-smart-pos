/**
 * Zachi Smart-POS — Job Card Controller
 * CRUD + Status transitions for print/graphics job tracking
 */
const pool = require('../db/pool');
const NotificationController = require('./notificationController');
const { notifyAssignee } = require('../services/notifyAssignee');
const objectStorage = require('../services/objectStorage');

// Fire-and-forget wrapper so the controller can call notifyAssignee
// without `await` and without an unhandled-rejection if a channel
// blows up. The helper itself already swallows per-channel errors;
// this catches anything that escapes (DB lookup blowing up, etc.).
function _notifyAssigneeAsync(userId, job, reason) {
    notifyAssignee(userId, job, reason).catch((e) => {
        console.error('[notify-assignee] fan-out failed:', e && e.message);
    });
}

// Generate job number: JOB-YYYYMMDD-NNN
async function generateJobNumber() {
    const today = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
    const result = await pool.query(
        "SELECT COUNT(*) AS count FROM job_cards WHERE job_number LIKE $1",
        [`JOB-${today}-%`]
    );
    const seq = String(parseInt(result.rows[0].count) + 1).padStart(3, '0');
    return `JOB-${today}-${seq}`;
}

/** GET /api/jobs — List all job cards */
async function listJobs(req, res) {
    try {
        const { status, assigned_to, priority } = req.query;
        let query = `
            SELECT jc.*, 
                   c.full_name AS customer_name, 
                   u.full_name AS assigned_name,
                   sv.service_name
            FROM job_cards jc
            LEFT JOIN customers c ON jc.customer_id = c.customer_id
            LEFT JOIN users u ON jc.assigned_to = u.user_id
            LEFT JOIN services sv ON jc.service_id = sv.service_id
            WHERE 1=1
        `;
        const params = [];
        if (status) { params.push(status); query += ` AND jc.status = $${params.length}`; }
        if (assigned_to) { params.push(assigned_to); query += ` AND jc.assigned_to = $${params.length}`; }
        if (priority) { params.push(priority); query += ` AND jc.priority = $${params.length}`; }
        query += ' ORDER BY jc.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('List jobs error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/jobs/:id — Get single job */
async function getJob(req, res) {
    try {
        const result = await pool.query(`
            SELECT jc.*, 
                   c.full_name AS customer_name, c.phone AS customer_phone,
                   u.full_name AS assigned_name,
                   sv.service_name
            FROM job_cards jc
            LEFT JOIN customers c ON jc.customer_id = c.customer_id
            LEFT JOIN users u ON jc.assigned_to = u.user_id
            LEFT JOIN services sv ON jc.service_id = sv.service_id
            WHERE jc.job_id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });

        // Also fetch proofs and costs
        const proofs = await pool.query('SELECT * FROM job_proofs WHERE job_id = $1 ORDER BY version DESC', [req.params.id]);
        const costs = await pool.query('SELECT * FROM job_costs WHERE job_id = $1', [req.params.id]);

        res.json({ ...result.rows[0], proofs: proofs.rows, costs: costs.rows });
    } catch (err) {
        console.error('Get job error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/jobs — Create new job card */
async function createJob(req, res) {
    try {
        const { service_id, customer_id, sale_id, sale_item_id, assigned_to, status, priority, specifications, deadline, deposit_amount, rush_fee, estimated_cost, file_attachment_url, customer_type } = req.body;
        const job_number = await generateJobNumber();
        const balance_due = (estimated_cost || 0) + (rush_fee || 0) - (deposit_amount || 0);

        const result = await pool.query(`
            INSERT INTO job_cards (job_number, service_id, customer_id, sale_id, sale_item_id, assigned_to, status, priority, specifications, deadline, deposit_amount, rush_fee, estimated_cost, balance_due, file_attachment_url, customer_type)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            RETURNING *
        `, [job_number, service_id, customer_id, sale_id || null, sale_item_id || null, assigned_to || null, status || 'Pending', priority || 'Normal', specifications, deadline || null, deposit_amount || 0, rush_fee || 0, estimated_cost || 0, balance_due, file_attachment_url || null, customer_type || 'Walk-in']);

        const job = result.rows[0];

        // Notify assigned user via EMAIL + SMS + WhatsApp + in-app.
        // Fire-and-forget: never block job creation on a slow SMS
        // provider or unreachable SMTP server.
        if (assigned_to) {
            _notifyAssigneeAsync(assigned_to, job, 'assigned');
        }

        res.status(201).json(job);
    } catch (err) {
        console.error('Create job error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** PATCH /api/jobs/:id — Update job card */
async function updateJob(req, res) {
    try {
        const { assigned_to, status, priority, specifications, deadline, deposit_amount, rush_fee, estimated_cost, file_attachment_url, customer_type } = req.body;

        // Pre-read the previous assignee so we can decide whether the
        // PATCH actually changed it. This avoids spamming external
        // channels (email/SMS/WhatsApp) when a caller PATCHes with the
        // SAME assigned_to as a no-op or a side-effect of a unrelated
        // edit — we only want a real reassignment to fan out.
        // Fail fast on the pre-read so a transient DB hiccup never
        // turns into noisy "ghost reassignment" notifications — if we
        // can't determine the previous assignee we can't decide whether
        // anything actually changed, so the whole PATCH must error out.
        const prev = await pool.query(
            'SELECT assigned_to FROM job_cards WHERE job_id = $1',
            [req.params.id]
        );
        if (prev.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });
        const previousAssignedTo = prev.rows[0].assigned_to;

        const result = await pool.query(`
            UPDATE job_cards SET 
                assigned_to = COALESCE($1, assigned_to),
                status = COALESCE($2, status),
                priority = COALESCE($3, priority),
                specifications = COALESCE($4, specifications),
                deadline = COALESCE($5, deadline),
                deposit_amount = COALESCE($6, deposit_amount),
                rush_fee = COALESCE($7, rush_fee),
                estimated_cost = COALESCE($8, estimated_cost),
                file_attachment_url = COALESCE($9, file_attachment_url),
                customer_type = COALESCE($10, customer_type),
                completed_at = CASE WHEN $2 = 'Completed' THEN NOW() ELSE completed_at END,
                updated_at = NOW()
            WHERE job_id = $11
            RETURNING *
        `, [assigned_to, status, priority, specifications, deadline, deposit_amount, rush_fee, estimated_cost, file_attachment_url, customer_type, req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });
        const job = result.rows[0];

        // Only fan out external channels (email/SMS/WhatsApp) when the
        // assignee genuinely changed. Same UUID = no-op; null new = no
        // notify; otherwise treat it as a real (re)assignment.
        const assigneeChanged = !!assigned_to
            && String(assigned_to) !== String(previousAssignedTo || '');
        if (assigneeChanged) {
            const reason = previousAssignedTo ? 'reassigned' : 'assigned';
            _notifyAssigneeAsync(assigned_to, job, reason);
        } else if (job.assigned_to) {
            // Plain edit (no reassignment). Keep the lightweight in-app
            // ping so users currently logged in see "job updated" in the
            // bell — but skip email/SMS/WhatsApp; we don't want to spam
            // someone every time a designer tweaks a deadline field.
            NotificationController.createNotification(
                job.assigned_to, 'job_update', `Job ${job.job_number} updated`, job.job_id
            );
        }

        res.json(job);
    } catch (err) {
        console.error('Update job error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** PATCH /api/jobs/:id/status — Transition job status */
async function updateJobStatus(req, res) {
    try {
        const { status } = req.body;
        const validStatuses = ['Pending', 'Designing', 'Proof Sent', 'Printing', 'Finishing', 'Ready', 'Delivered', 'Collected'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` });

        const completedAt = ['Delivered', 'Collected'].includes(status) ? 'NOW()' : 'completed_at';
        const result = await pool.query(`
            UPDATE job_cards SET status = $1, completed_at = ${['Delivered', 'Collected'].includes(status) ? 'NOW()' : 'completed_at'}, updated_at = NOW()
            WHERE job_id = $2 RETURNING *
        `, [status, req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });
        const job = result.rows[0];

        if (job.assigned_to) {
            NotificationController.createNotification(
                job.assigned_to,
                'job_status',
                `Job ${job.job_number} is now ${status}`,
                job.job_id
            );
        }

        // Notify Director implementation (optional, keeps noise down)
        // NotificationController.notifyRole('director', 'job_status', ...);

        res.json(job);
    } catch (err) {
        console.error('Update job status error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** DELETE /api/jobs/:id — Delete job card */
async function deleteJob(req, res) {
    try {
        const result = await pool.query('DELETE FROM job_cards WHERE job_id = $1 RETURNING job_id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });
        res.json({ message: 'Job deleted.' });
    } catch (err) {
        console.error('Delete job error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/jobs/:id/proofs — Add proof version.
 *
 * Two payload shapes are accepted (back-compat with v1.0.21 clients):
 *
 *   1. multipart/form-data (v1.0.22+ "Choose file" flow):
 *        file:  <binary>          required when uploading locally
 *        notes: <text>            optional
 *      The file is uploaded to Replit Object Storage and the proof's
 *      file_url points at our /api/jobs/:id/proofs/:proofId/file
 *      streaming endpoint.
 *
 *   2. application/json (legacy "paste a URL" flow):
 *        { file_url: "https://drive.google.com/...", notes: "..." }
 *      Behaviour unchanged from v1.0.21 — no upload, just stores the
 *      URL verbatim. Old Android/Windows wrappers in the wild keep
 *      working.
 */
async function addProof(req, res) {
    try {
        const verResult = await pool.query(
            'SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM job_proofs WHERE job_id = $1',
            [req.params.id]
        );
        const version = verResult.rows[0].next_ver;
        const notes = (req.body && req.body.notes) || null;

        let fileUrl = null;
        let fileName = null;
        let mimeType = null;
        let sizeBytes = null;
        let objectPath = null;

        if (req.file) {
            // multipart upload — push to object storage, then point
            // file_url at our streaming route so the browser fetches
            // through us (lets us add ACL later without a URL change).
            if (!objectStorage.isConfigured()) {
                return res.status(503).json({
                    error: 'File uploads are not configured on this server. Paste a URL instead, or contact your administrator.'
                });
            }
            fileName = req.file.originalname || 'proof';
            mimeType = req.file.mimetype || 'application/octet-stream';
            sizeBytes = req.file.size;
            const key = objectStorage.makeObjectKey(`job-proofs/${req.params.id}`, fileName);
            const stored = await objectStorage.putBuffer({
                buffer: req.file.buffer,
                key,
                mimeType,
            });
            objectPath = stored.objectPath;
            // file_url is filled in *after* INSERT, once we know the
            // proof_id, so the URL is self-describing and stable.
        } else if (req.body && req.body.file_url) {
            fileUrl = String(req.body.file_url).trim();
            // Only accept plain web links. Anything else (javascript:,
            // data:, vbscript:, file:, blank, …) could execute code in
            // a colleague's browser when they later click the proof.
            // The HTML output is escaped, but the click destination is
            // not — so we reject at the API boundary.
            if (!/^https?:\/\//i.test(fileUrl)) {
                return res.status(400).json({
                    error: 'Proof URL must start with http:// or https://.'
                });
            }
        } else {
            return res.status(400).json({
                error: 'Provide either a file (multipart) or a file_url (JSON).'
            });
        }

        const result = await pool.query(`
            INSERT INTO job_proofs (
                job_id, version, file_url, notes, uploaded_by,
                file_name, mime_type, size_bytes, object_path
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            req.params.id, version, fileUrl, notes, req.user.user_id,
            fileName, mimeType, sizeBytes, objectPath,
        ]);
        const row = result.rows[0];

        // For uploaded files, fill in the streaming URL now that we
        // have a proof_id. Cheaper than a CTE and keeps the schema
        // simple.
        if (objectPath && !row.file_url) {
            const url = `/api/jobs/${req.params.id}/proofs/${row.proof_id}/file`;
            const upd = await pool.query(
                'UPDATE job_proofs SET file_url = $1 WHERE proof_id = $2 RETURNING *',
                [url, row.proof_id]
            );
            Object.assign(row, upd.rows[0]);
        }

        // Update job status to 'Proof Sent' if currently 'Designing'
        await pool.query(
            "UPDATE job_cards SET status = 'Proof Sent', updated_at = NOW() WHERE job_id = $1 AND status = 'Designing'",
            [req.params.id]
        );

        res.status(201).json(row);
    } catch (err) {
        console.error('Add proof error:', err);
        // Multer errors (file too big, wrong mime) surface as
        // err.code === 'LIMIT_FILE_SIZE' etc. — give the client a
        // friendly message instead of a generic 500.
        if (err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });
        }
        res.status(500).json({ error: err.message || 'Server error.' });
    }
}

/**
 * GET /api/jobs/:id/proofs/:proofId/file — Stream a proof's bytes
 * back from object storage. Used by the v1.0.22+ "Choose file"
 * flow; URL-only legacy proofs link straight to the external host
 * and never hit this route.
 */
async function getProofFile(req, res) {
    try {
        const r = await pool.query(
            'SELECT object_path, mime_type, file_name FROM job_proofs WHERE proof_id = $1 AND job_id = $2',
            [req.params.proofId, req.params.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Proof not found.' });
        const proof = r.rows[0];
        if (!proof.object_path) {
            return res.status(404).json({
                error: 'This proof has no uploaded file (URL-only proof).'
            });
        }
        await objectStorage.streamObject({
            key: proof.object_path,
            mimeType: proof.mime_type,
            downloadName: proof.file_name,
            res,
        });
    } catch (err) {
        console.error('Get proof file error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || 'Server error.' });
        }
    }
}

/** PATCH /api/jobs/:id/proofs/:proofId — Update proof status (approve/reject) */
async function updateProofStatus(req, res) {
    try {
        const { status, approved_by } = req.body;
        console.log(`Updating proof: job=${req.params.id}, proof=${req.params.proofId}, status=${status}, by=${approved_by}`);

        const result = await pool.query(`
            UPDATE job_proofs SET status = $1, approved_by = $2, approved_at = CASE WHEN $5 = 'Approved' THEN NOW() ELSE approved_at END
            WHERE proof_id = $3 AND job_id = $4 RETURNING *
        `, [status, approved_by, req.params.proofId, req.params.id, status]);

        if (result.rows.length === 0) {
            console.log('Proof not found or no change.');
            return res.status(404).json({ error: 'Proof not found.' });
        }

        // If approved, auto-advance job to 'Printing'
        if (status === 'Approved') {
            const jobUpdate = await pool.query("UPDATE job_cards SET status = 'Printing', updated_at = NOW() WHERE job_id = $1 AND status = 'Proof Sent' RETURNING *", [req.params.id]);
            console.log('Job auto-advanced:', jobUpdate.rowCount);
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update proof status error FULL:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
}

/** POST /api/jobs/:id/costs — Record a cost */
async function addCost(req, res) {
    try {
        const { cost_type, description, quantity, unit_cost } = req.body;
        const total_cost = (quantity || 1) * unit_cost;

        const result = await pool.query(`
            INSERT INTO job_costs (job_id, cost_type, description, quantity, unit_cost, total_cost, recorded_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
        `, [req.params.id, cost_type, description, quantity || 1, unit_cost, total_cost, req.user.user_id]);

        // Update actual cost on job
        const sumResult = await pool.query('SELECT COALESCE(SUM(total_cost), 0) AS total FROM job_costs WHERE job_id = $1', [req.params.id]);
        await pool.query('UPDATE job_cards SET actual_cost = $1, updated_at = NOW() WHERE job_id = $2', [sumResult.rows[0].total, req.params.id]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Add cost error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/jobs/stats/pipeline — Pipeline stats for Kanban header */
async function getJobStats(req, res) {
    try {
        const result = await pool.query(`
            SELECT status, COUNT(*) AS count 
            FROM job_cards 
            GROUP BY status
            ORDER BY CASE status
                WHEN 'Pending' THEN 1
                WHEN 'Designing' THEN 2
                WHEN 'Proof Sent' THEN 3
                WHEN 'Printing' THEN 4
                WHEN 'Finishing' THEN 5
                WHEN 'Ready' THEN 6
                WHEN 'Delivered' THEN 7
                WHEN 'Collected' THEN 8
            END
        `);

        // Also get totals
        const totals = await pool.query(`
            SELECT 
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('Delivered', 'Collected')) AS active,
                COUNT(*) FILTER (WHERE priority = 'Urgent') AS urgent,
                COALESCE(SUM(balance_due), 0) AS total_balance_due
            FROM job_cards
        `);

        res.json({ pipeline: result.rows, ...totals.rows[0] });
    } catch (err) {
        console.error('Get job stats error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { listJobs, getJob, createJob, updateJob, updateJobStatus, deleteJob, addProof, getProofFile, updateProofStatus, addCost, getJobStats };
