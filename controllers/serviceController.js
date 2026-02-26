const pool = require('../db/pool');

/**
 * GET /api/services
 */
async function listServices(req, res) {
    try {
        const { category, active_only } = req.query;
        const params = [];
        const conditions = [];

        if (category) {
            params.push(category);
            conditions.push(`category = $${params.length}`);
        }

        if (active_only !== 'false') {
            conditions.push('is_active = TRUE');
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(`SELECT * FROM services ${where} ORDER BY category, service_name`, params);
        res.json({ services: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/services
 */
async function createService(req, res) {
    try {
        const { service_name, category, base_price, unit_measure, description } = req.body;
        if (!service_name) return res.status(400).json({ error: 'Service name is required.' });

        const result = await pool.query(
            `INSERT INTO services (service_name, category, base_price, unit_measure, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [service_name, category || null, base_price || 0, unit_measure || 'fixed', description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * PUT /api/services/:id
 */
async function updateService(req, res) {
    try {
        const { service_name, category, base_price, unit_measure, is_active, description } = req.body;
        const result = await pool.query(
            `UPDATE services SET
        service_name = COALESCE($1, service_name),
        category = COALESCE($2, category),
        base_price = COALESCE($3, base_price),
        unit_measure = COALESCE($4, unit_measure),
        is_active = COALESCE($5, is_active),
        description = COALESCE($6, description)
       WHERE service_id = $7 RETURNING *`,
            [service_name, category, base_price, unit_measure, is_active, description, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Service not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * DELETE /api/services/:id
 */
async function deleteService(req, res) {
    try {
        const result = await pool.query('DELETE FROM services WHERE service_id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Service not found.' });
        res.json({ message: 'Service deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/services/bulk-delete
 */
async function bulkDeleteServices(req, res) {
    try {
        const { ids } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

        await pool.query('DELETE FROM services WHERE service_id = ANY($1)', [ids]);
        res.json({ message: `${ids.length} service(s) deleted successfully` });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/services/bulk-update
 */
async function bulkUpdateServices(req, res) {
    try {
        const { ids, action, value, field } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

        if (action === 'category') {
            await pool.query('UPDATE services SET category = $1 WHERE service_id = ANY($2)', [value, ids]);
        } else if (action === 'price') {
            const factor = 1 + (parseFloat(value) / 100);
            await pool.query('UPDATE services SET base_price = base_price * $1 WHERE service_id = ANY($2)', [factor, ids]);
        }

        res.json({ message: `${ids.length} service(s) updated successfully` });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/services/categories
 */
async function getCategories(req, res) {
    try {
        const result = await pool.query('SELECT DISTINCT category FROM services WHERE category IS NOT NULL');
        res.json({ categories: result.rows.map(r => r.category) });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = {
    listServices,
    createService,
    updateService,
    deleteService,
    getCategories,
    bulkDeleteServices,
    bulkUpdateServices
};
