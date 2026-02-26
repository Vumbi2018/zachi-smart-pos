/**
 * Zachi Smart-POS — Job Card Controller
 * CRUD + Status transitions for print/graphics job tracking
 */
const pool = require('../db/pool');
const NotificationController = require('./notificationController');

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

        // Notify assigned user
        if (assigned_to) {
            NotificationController.createNotification(
                assigned_to,
                'job_assigned',
                `New split assigned: ${job_number}`,
                job.job_id
            );
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

        // Notify if assigned_to changed or status changed
        if (assigned_to && assigned_to !== job.assigned_to) {
            NotificationController.createNotification(assigned_to, 'job_assigned', `Job ${job.job_number} assigned to you`, job.job_id);
        }

        // Notify assignee of updates
        if (job.assigned_to) {
            NotificationController.createNotification(job.assigned_to, 'job_update', `Job ${job.job_number} updated`, job.job_id);
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

/** POST /api/jobs/:id/proofs — Add proof version */
async function addProof(req, res) {
    try {
        const { file_url, notes } = req.body;
        // Get next version number
        const verResult = await pool.query('SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM job_proofs WHERE job_id = $1', [req.params.id]);
        const version = verResult.rows[0].next_ver;

        const result = await pool.query(`
            INSERT INTO job_proofs (job_id, version, file_url, notes, uploaded_by)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [req.params.id, version, file_url, notes, req.user.user_id]);

        // Update job status to 'Proof Sent' if currently 'Designing'
        await pool.query("UPDATE job_cards SET status = 'Proof Sent', updated_at = NOW() WHERE job_id = $1 AND status = 'Designing'", [req.params.id]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Add proof error:', err);
        res.status(500).json({ error: 'Server error.' });
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

module.exports = { listJobs, getJob, createJob, updateJob, updateJobStatus, deleteJob, addProof, updateProofStatus, addCost, getJobStats };
