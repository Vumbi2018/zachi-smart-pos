const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { sendEmail } = require('../utils/email');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const RESET_TOKEN_TTL_MIN = 30;

// Soft account-lockout policy.
// We track per-user failed attempts in the users table. After
// FAILED_LOGIN_THRESHOLD consecutive failures we set locked_until to
// NOW() + LOCKOUT_COOLDOWN_MIN. While locked_until is in the future,
// even a correct password is rejected with HTTP 429. Successful login
// resets failed_attempts to 0 and clears locked_until.
// Threshold matches the per-IP / per-username rate limiter (5/15min) so
// that an attacker can't bypass the limiter by rotating IPs without also
// hitting the DB-side lockout. Both are deployment-tunable.
const FAILED_LOGIN_THRESHOLD = parseInt(process.env.FAILED_LOGIN_THRESHOLD, 10) || 5;
const LOCKOUT_COOLDOWN_MIN = parseInt(process.env.LOCKOUT_COOLDOWN_MIN, 10) || 15;

function genericInvalidLogin(res) {
    return res.status(401).json({ error: 'Invalid username or password.' });
}

function lockedResponse(res) {
    return res.status(429).json({
        error: 'Too many failed attempts. Please try again later or reset your password.',
    });
}

/**
 * Increment failed_attempts for a user (looked up by username) and, if
 * the threshold is hit, set locked_until to NOW() + LOCKOUT_COOLDOWN_MIN.
 * Also writes a LOGIN_FAILED audit row for forensic trails.
 */
async function recordFailedLogin(username, ip, userId = null) {
    try {
        if (userId) {
            await pool.query(
                `UPDATE users
                 SET failed_attempts = failed_attempts + 1,
                     locked_until = CASE
                         WHEN failed_attempts + 1 >= $2
                         THEN NOW() + make_interval(mins => $3::int)
                         ELSE locked_until
                     END
                 WHERE user_id = $1`,
                [userId, FAILED_LOGIN_THRESHOLD, LOCKOUT_COOLDOWN_MIN]
            );
        }
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, table_name, new_value, ip_address)
             VALUES ($1, 'LOGIN_FAILED', 'users', $2, $3)`,
            [userId, JSON.stringify({ username }), ip]
        );
    } catch (err) {
        console.error('recordFailedLogin error:', err.message);
    }
}

async function clearLockoutState(userId) {
    try {
        await pool.query(
            `UPDATE users
             SET failed_attempts = 0,
                 locked_until = NULL
             WHERE user_id = $1`,
            [userId]
        );
    } catch (err) {
        console.error('clearLockoutState error:', err.message);
    }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
    try {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
            [username]
        );

        if (result.rows.length === 0) {
            // No matching active user — record the attempt without a user_id.
            await recordFailedLogin(username, req.ip, null);
            return genericInvalidLogin(res);
        }

        const user = result.rows[0];

        // Per-user lockout check (first-class column)
        if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
            return lockedResponse(res);
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            await recordFailedLogin(username, req.ip, user.user_id);

            // Re-read to see whether this attempt tipped us over the edge.
            const after = await pool.query(
                'SELECT locked_until FROM users WHERE user_id = $1',
                [user.user_id]
            );
            const lockedUntil = after.rows[0]?.locked_until;
            if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
                return lockedResponse(res);
            }
            return genericInvalidLogin(res);
        }

        // Successful login → clear lockout state.
        await clearLockoutState(user.user_id);

        const token = jwt.sign(
            {
                user_id: user.user_id,
                username: user.username,
                role: user.role,
                full_name: user.full_name,
            },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

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
                role: user.role,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/auth/register  (Director only)
 */
async function register(req, res) {
    try {
        const { username, password, full_name, email, phone, role } = req.body || {};

        if (!username || !password || !full_name || !role) {
            return res
                .status(400)
                .json({ error: 'Username, password, full_name, and role are required.' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const validRoles = ['director', 'cashier', 'designer', 'consultant'];
        if (!validRoles.includes(role)) {
            return res
                .status(400)
                .json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        const existing = await pool.query('SELECT user_id FROM users WHERE username = $1', [
            username,
        ]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users (username, password_hash, full_name, email, phone, role)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING user_id, username, full_name, role`,
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
 */
async function getProfile(req, res) {
    try {
        const result = await pool.query(
            `SELECT user_id, username, full_name, email, phone, role, created_at
             FROM users WHERE user_id = $1`,
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

/**
 * GET /api/auth/me/permissions
 *
 * Returns the *effective* permission name list (role defaults ∪
 * per-user grants − per-user revokes) for the **currently
 * authenticated user**. Any authenticated user can call this for
 * themselves — the sidebar / page guards rely on it to know what to
 * show, and the previous director-only endpoint at
 * /api/users/:id/permissions was 403'ing for non-directors.
 *
 * Director is reported as a wildcard so the client can skip the
 * lookup table entirely.
 */
async function getMyPermissions(req, res) {
    try {
        if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
        if (req.user.role === 'director') {
            return res.json({
                user_id: req.user.user_id,
                role: 'director',
                wildcard: true,
                permissions: ['*'],
            });
        }
        const { resolveEffectivePermissions } = require('../services/userPermissions');
        const set = await resolveEffectivePermissions(null, req.user.user_id);
        res.json({
            user_id: req.user.user_id,
            role: req.user.role,
            wildcard: false,
            permissions: Array.from(set).sort(),
        });
    } catch (err) {
        console.error('[getMyPermissions]', err);
        res.status(500).json({ error: 'Permission resolver error.' });
    }
}

/**
 * POST /api/auth/forgot-password
 *
 * Always returns 200 with the same payload regardless of whether the
 * username exists, to prevent user enumeration. If a matching user is
 * found and has an email on file, a reset link is sent in the background.
 */
async function forgotPassword(req, res) {
    const genericOk = () =>
        res.json({
            ok: true,
            message:
                'If that account exists and has an email on file, a password reset link has been sent.',
        });

    try {
        const { username } = req.body || {};
        if (!username || typeof username !== 'string') return genericOk();

        const r = await pool.query(
            'SELECT user_id, email, full_name FROM users WHERE username = $1 AND is_active = TRUE',
            [username]
        );

        if (r.rows.length === 0) return genericOk();
        const user = r.rows[0];
        if (!user.email) return genericOk();

        // Generate token, store hash + expiry, send email.
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);

        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, $3)`,
            [user.user_id, tokenHash, expiresAt]
        );

        const baseUrl =
            process.env.APP_BASE_URL ||
            `${req.protocol}://${req.get('host')}`;
        const resetUrl = `${baseUrl}/#/reset-password?token=${rawToken}`;

        // Fire-and-forget email; do not block the response on SMTP.
        sendEmail(
            user.email,
            'Reset your Zachi POS password',
            `<p>Hi ${user.full_name || 'there'},</p>
             <p>You (or someone using your username) asked to reset your Zachi POS password.</p>
             <p><a href="${resetUrl}">Click here to reset your password</a> — link valid for ${RESET_TOKEN_TTL_MIN} minutes.</p>
             <p>If you did not request this, you can safely ignore this email.</p>`
        ).catch((err) => console.error('forgot-password email error:', err.message));

        return genericOk();
    } catch (err) {
        console.error('forgotPassword error:', err);
        // Even on internal error, do not leak the failure mode.
        return res.json({
            ok: true,
            message:
                'If that account exists and has an email on file, a password reset link has been sent.',
        });
    }
}

/**
 * POST /api/auth/reset-password
 * Body: { token, new_password }  (legacy `password` is also accepted)
 */
async function resetPassword(req, res) {
    try {
        // Accept either `new_password` (canonical) or `password` (the
        // legacy field name still used by the shipped auth modal). Either
        // one is fine, but we never read both.
        const body = req.body || {};
        const token = body.token;
        const newPassword = body.new_password ?? body.password;
        if (!token || !newPassword || newPassword.length < 8) {
            return res.status(400).json({
                error: 'Token and a new password (min 8 chars) are required.',
            });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const r = await pool.query(
            `SELECT prt.token_id, prt.user_id
             FROM password_reset_tokens prt
             WHERE prt.token_hash = $1
               AND prt.used_at IS NULL
               AND prt.expires_at > NOW()`,
            [tokenHash]
        );
        if (r.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired token.' });
        }
        const { token_id, user_id } = r.rows[0];
        const newHash = await bcrypt.hash(newPassword, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE user_id = $2', [newHash, user_id]);
            await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE token_id = $1', [token_id]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        res.json({ ok: true, message: 'Password updated. You can now sign in.' });
    } catch (err) {
        console.error('resetPassword error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * PUT /api/auth/me
 *
 * Lets the signed-in user update their own contact details
 * (full_name, email, phone). Username and role are deliberately
 * not editable here — those go through Director-only flows.
 */
async function updateProfile(req, res) {
    try {
        const { full_name, email, phone } = req.body || {};

        // Normalize / validate. Empty string maps to NULL so directors
        // can clear an optional field, not just change it.
        const fullName = full_name == null ? null : String(full_name).trim();
        const cleanEmail = email == null ? null : String(email).trim();
        const cleanPhone = phone == null ? null : String(phone).trim();

        if (fullName !== null && fullName.length === 0) {
            return res.status(400).json({ error: 'Full name cannot be empty.' });
        }
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ error: 'Invalid email address.' });
        }

        // Explicit duplicate-email check. The users.email column does not have
        // a UNIQUE constraint (multiple legacy NULLs would block adding one
        // safely), so enforce uniqueness in code. Comparison is case-insensitive
        // because the same address with different casing is the same mailbox.
        if (cleanEmail) {
            const dup = await pool.query(
                `SELECT user_id FROM users
                  WHERE LOWER(email) = LOWER($1)
                    AND user_id <> $2
                  LIMIT 1`,
                [cleanEmail, req.user.user_id]
            );
            if (dup.rows.length > 0) {
                return res.status(409).json({ error: 'That email address is already in use.' });
            }
        }

        const result = await pool.query(
            `UPDATE users
                SET full_name = COALESCE($2, full_name),
                    email     = $3,
                    phone     = $4,
                    updated_at = NOW()
              WHERE user_id = $1
              RETURNING user_id, username, full_name, email, phone, role`,
            [req.user.user_id, fullName, cleanEmail || null, cleanPhone || null]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateProfile error:', err);
        // Unique-constraint violation on email — surface a friendly message.
        if (err && err.code === '23505') {
            return res.status(409).json({ error: 'That email address is already in use.' });
        }
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/auth/me/password
 *
 * Self-service password change. Requires the current password as proof
 * of identity, even for the signed-in user — this is the same pattern
 * GitHub / Google use, and prevents a stolen unlocked session from
 * silently rotating the password and locking out the legitimate owner.
 */
async function changePassword(req, res) {
    try {
        const { current_password, new_password } = req.body || {};
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Current and new password are required.' });
        }
        if (String(new_password).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
        }

        const r = await pool.query(
            `SELECT password_hash FROM users WHERE user_id = $1`,
            [req.user.user_id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

        const ok = await bcrypt.compare(current_password, r.rows[0].password_hash);
        if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

        const hash = await bcrypt.hash(new_password, 12);
        await pool.query(
            `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE user_id = $1`,
            [req.user.user_id, hash]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('changePassword error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = {
    getMyPermissions,
    login,
    register,
    getProfile,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
    // Exported for tests / monitoring
    FAILED_LOGIN_THRESHOLD,
    LOCKOUT_COOLDOWN_MIN,
};
