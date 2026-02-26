const pool = require('../db/pool');

const PaymentController = {
    async getAllMethods(req, res) {
        try {
            // Fetch all (including inactive) for admin management if query param set
            const showAll = req.query.all === 'true';
            const query = showAll
                ? 'SELECT * FROM payment_methods ORDER BY id'
                : 'SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY id';

            const result = await pool.query(query);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    async createMethod(req, res) {
        const { name, type, config } = req.body;
        try {
            const result = await pool.query(
                'INSERT INTO payment_methods (name, type, config) VALUES ($1, $2, $3) RETURNING *',
                [name, type, config || {}]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            if (err.code === '23505') {
                return res.status(400).json({ error: 'Payment method already exists' });
            }
            res.status(500).json({ error: 'Server error' });
        }
    },

    async updateMethod(req, res) {
        const { id } = req.params;
        const { name, type, is_active, config } = req.body;
        try {
            const result = await pool.query(
                `UPDATE payment_methods 
                 SET name = COALESCE($1, name), 
                     type = COALESCE($2, type), 
                     is_active = COALESCE($3, is_active), 
                     config = COALESCE($4, config) 
                 WHERE id = $5 RETURNING *`,
                [name, type, is_active, config, id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Payment method not found' });
            }
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    async deleteMethod(req, res) {
        const { id } = req.params;
        try {
            // Soft delete by setting is_active = false preferred, but let's allow hard delete if no dependencies?
            // Actually, safe bet is soft delete or check usage. 
            // For now, let's just toggle is_active via Update, maybe Delete isn't needed if we have Update.
            // But let's implement Delete as a hard delete for cleanup of unused methods.
            const result = await pool.query('DELETE FROM payment_methods WHERE id = $1 RETURNING *', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Payment method not found' });
            }
            res.json({ message: 'Payment method deleted' });
        } catch (err) {
            console.error(err);
            // Likely foreign key constraint if used in sales
            res.status(400).json({ error: 'Cannot delete method referenced in sales. Deactivate it instead.' });
        }
    }
};

module.exports = PaymentController;
