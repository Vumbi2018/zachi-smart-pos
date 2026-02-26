const pool = require('../db/pool');
const NotificationController = require('./notificationController');

/**
 * GET /api/approvals
 * List pending approvals
 */
async function listApprovals(req, res) {
    try {
        const result = await pool.query(`
            SELECT ar.*, u.full_name as requester_name 
            FROM approval_requests ar
            JOIN users u ON ar.requested_by = u.user_id
            WHERE ar.status = 'Pending'
            ORDER BY ar.created_at ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /api/approvals
 * Create a new approval request
 */
async function createApproval(req, res) {
    try {
        const { request_type, entity_type, entity_id, reason, details } = req.body;

        const result = await pool.query(`
            INSERT INTO approval_requests (request_type, entity_type, entity_id, requested_by, reason, details)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [request_type, entity_type, entity_id, req.user.user_id, reason, details]);

        const request = result.rows[0];

        // Notify Directors and Managers
        NotificationController.notifyRole(['director', 'manager'], 'approval_needed', `New ${request_type} approval request`, request.request_id);

        res.status(201).json(request);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /api/approvals/:id/decide
 * Approve or Reject a request
 */
async function decideApproval(req, res) {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { decision, decision_reason } = req.body; // 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected'].includes(decision)) {
            return res.status(400).json({ error: 'Invalid decision' });
        }

        await client.query('BEGIN');

        // 1. Update Request
        const result = await client.query(`
            UPDATE approval_requests 
            SET status = $1, approved_by = $2, decided_at = NOW(), decision_reason = $3
            WHERE request_id = $4 AND status = 'Pending'
            RETURNING *
        `, [decision, req.user.user_id, decision_reason, id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Request not found or already processed' });
        }

        const request = result.rows[0];

        // 2. Perform Action if Approved
        if (decision === 'Approved') {
            await executeAction(client, request, req.user.user_id);
        }

        await client.query('COMMIT');

        // Notify Requester
        NotificationController.createNotification(
            request.requested_by,
            'approval_decision',
            `Your request for ${request.request_type} was ${decision}`,
            request.request_id
        );

        res.json({ message: `Request ${decision}`, request });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}

// Logic to execute the actual requested action upon approval
async function executeAction(client, request, approverId) {
    const details = request.details || {};

    switch (request.request_type) {
        case 'stock_adjustment':
            // Finalize stock adjustment
            // 1. Update product stock
            // 2. Insert inventory movement
            if (details.adjustments) {
                for (const adj of details.adjustments) {
                    await client.query(`
                        UPDATE products SET stock_quantity = stock_quantity + $1 WHERE product_id = $2
                    `, [adj.quantity, adj.product_id]);

                    await client.query(`
                        INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, reason, performed_by)
                        VALUES ($1, 'ADJUSTMENT', $2, 'approval_request', $3, $4, $5)
                    `, [adj.product_id, adj.quantity, request.request_id, request.reason, approverId]);
                }
            }
            break;

        case 'void_sale':
            // Logic to void a sale would go here
            break;

        default:
            console.warn('Unknown request type execution:', request.request_type);
    }
}

module.exports = { listApprovals, createApproval, decideApproval };
