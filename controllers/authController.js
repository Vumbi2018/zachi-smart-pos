const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

/**
 * POST /api/auth/login
 * Authenticate user and return JWT
 */
async function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const token = jwt.sign(
            {
                user_id: user.user_id,
                username: user.username,
                role: user.role,
                full_name: user.full_name
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // Log login action
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, table_name, ip_address)
       VALUES ($1, 'LOGIN', 'users', $2)`,
            [user.user_id, req.ip]
        );

        res.json({
            token,
            user: {
                user_id: user.user_id,
                username: user.username,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login.' });
    }
}

/**
 * POST /api/auth/register
 * Create a new staff account (Director only)
 */
async function register(req, res) {
    try {
        const { username, password, full_name, email, phone, role } = req.body;

        if (!username || !password || !full_name || !role) {
            return res.status(400).json({ error: 'Username, password, full_name, and role are required.' });
        }

        const validRoles = ['director', 'cashier', 'designer', 'consultant'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        // Check if username exists
        const existing = await pool.query('SELECT user_id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const result = await pool.query(
            `INSERT INTO users (username, password_hash, full_name, email, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id, username, full_name, role`,
            [username, passwordHash, full_name, email || null, phone || null, role]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error during registration.' });
    }
}

/**
 * GET /api/auth/me
 * Get current user profile
 */
async function getProfile(req, res) {
    try {
        const result = await pool.query(
            'SELECT user_id, username, full_name, email, phone, role, created_at FROM users WHERE user_id = $1',
            [req.user.user_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { login, register, getProfile };
