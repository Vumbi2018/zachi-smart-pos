const pool = require('../db/pool');

const NotificationController = {
    async createNotification(userId, type, message, relatedId = null) {
        try {
            const result = await pool.query(
                'INSERT INTO notifications (user_id, type, message, related_id) VALUES ($1, $2, $3, $4) RETURNING *',
                [userId, type, message, relatedId]
            );
            return result.rows[0];
        } catch (err) {
            console.error('Error creating notification:', err);
            return null;
        }
    },

    async notifyRole(role, type, message, relatedId = null) {
        try {
            // Find all users with this role (or roles if array)
            let query = 'SELECT user_id FROM users WHERE is_active = true AND role = $1';
            let params = [role];

            if (Array.isArray(role)) {
                query = 'SELECT user_id FROM users WHERE is_active = true AND role = ANY($1)';
                params = [role];
            }

            const users = await pool.query(query, params);

            const notifications = users.rows.map(u =>
                this.createNotification(u.user_id, type, message, relatedId)
            );

            await Promise.all(notifications);
        } catch (err) {
            console.error('Error notifying role:', err);
        }
    },

    async getUnread(req, res) {
        try {
            // Assuming req.user is set by authentication middleware
            const userId = req.user.user_id;
            const result = await pool.query(
                'SELECT * FROM notifications WHERE user_id = $1 AND is_read = FALSE ORDER BY created_at DESC LIMIT 50',
                [userId]
            );
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    async markRead(req, res) {
        const { id } = req.params;
        const userId = req.user.user_id;

        try {
            // Ensure user owns notification
            const result = await pool.query(
                'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
                [id, userId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Notification not found or access denied' });
            }
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    async markAllRead(req, res) {
        const userId = req.user.user_id;
        try {
            await pool.query(
                'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
                [userId]
            );
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
};

module.exports = NotificationController;
