/**
 * userPermissions.js
 *
 * Computes the *effective* permission set for a given user as:
 *
 *     effective = (role_default ∪ user_grant) − user_deny
 *
 * Returns permission **names** (e.g. 'invoice.send'). Names are the
 * stable contract — ids drift between dev (SERIAL) and prod (UUID).
 *
 * Reconciles user-level overrides against a target list of names:
 * permissions on the target list become granted=TRUE rows, anything
 * NOT on the list that the role would normally grant becomes a
 * granted=FALSE row, and the rest are deleted.
 */
'use strict';

const pool = require('../db/pool');

/**
 * Resolve the set of permission names a user effectively has.
 * @param {pg.Client|pg.Pool} client – pool or transactional client
 * @param {string|number}     userId
 * @returns {Promise<Set<string>>}
 */
async function resolveEffectivePermissions(client, userId) {
    const conn = client || pool;
    const r = await conn.query(
        `WITH role_defaults AS (
             SELECT p.id AS permission_id, p.name
             FROM users u
             JOIN role_permissions rp ON rp.role = u.role
             JOIN permissions       p  ON p.id   = rp.permission_id
             WHERE u.user_id = $1
         ),
         overrides AS (
             SELECT up.permission_id, p.name, up.granted
             FROM user_permissions up
             JOIN permissions p ON p.id = up.permission_id
             WHERE up.user_id = $1
         )
         SELECT name
         FROM role_defaults
         WHERE permission_id NOT IN (SELECT permission_id FROM overrides WHERE granted = FALSE)
         UNION
         SELECT name
         FROM overrides
         WHERE granted = TRUE`,
        [userId]
    );
    return new Set(r.rows.map((row) => row.name));
}

/**
 * Reconcile a user's per-user overrides so the effective set ends up
 * equal to `desiredNames`. Mechanics:
 *   - Compute role defaults + permission catalogue.
 *   - For each catalogue permission:
 *       desired ∧ in-role  → no row  (default is enough)
 *       desired ∧ ¬in-role → granted=TRUE override
 *       ¬desired ∧ in-role → granted=FALSE override
 *       ¬desired ∧ ¬in-role → no row
 *   - Bulk-replace user_permissions for that user inside the caller's
 *     transaction.
 *
 * @param {pg.Client}      client – transactional client
 * @param {string|number}  userId
 * @param {string|number}  grantedBy – the director performing the change
 * @param {string[]}       desiredNames
 * @returns {Promise<{added:number, denied:number, cleared:number, skipped:string[]}>}
 */
async function reconcileUserPermissions(client, userId, grantedBy, desiredNames) {
    if (!Array.isArray(desiredNames)) {
        throw new Error('reconcileUserPermissions: desiredNames must be an array');
    }
    const desired = new Set(
        desiredNames
            .filter((n) => typeof n === 'string')
            .map((n) => n.trim())
            .filter(Boolean)
    );

    // Look up the user's role to figure out role defaults.
    const u = await client.query(
        'SELECT role FROM users WHERE user_id = $1',
        [userId]
    );
    if (u.rows.length === 0) throw new Error('reconcileUserPermissions: user not found');
    const role = u.rows[0].role;

    // Catalogue + role defaults in one round-trip.
    const cat = await client.query(
        `SELECT p.id AS permission_id, p.name,
                EXISTS (
                    SELECT 1 FROM role_permissions rp
                    WHERE rp.role = $1 AND rp.permission_id = p.id
                ) AS in_role
         FROM permissions p`,
        [role]
    );

    const desiredPerms = [];   // {permission_id, granted: TRUE}
    const deniedPerms = [];    // {permission_id, granted: FALSE}
    const skipped = [];        // names from desiredNames that aren't in the catalogue
    const matched = new Set();

    for (const row of cat.rows) {
        const wanted = desired.has(row.name);
        if (wanted) matched.add(row.name);
        if (wanted && !row.in_role) {
            desiredPerms.push({ id: row.permission_id, granted: true });
        } else if (!wanted && row.in_role) {
            deniedPerms.push({ id: row.permission_id, granted: false });
        }
    }
    for (const n of desired) {
        if (!matched.has(n)) skipped.push(n);
    }

    // Wipe + reinsert. A user's override set is small (typically <100
    // rows even after expansion) so the simple delete-and-insert pattern
    // is plenty fast and gives us a clean atomic swap.
    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

    const all = [...desiredPerms, ...deniedPerms];
    if (all.length > 0) {
        const grantedByIdx = all.length * 2 + 2;
        const values = all
            .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}, $${grantedByIdx})`)
            .join(',');
        const params = [userId];
        for (const it of all) {
            params.push(it.id, it.granted);
        }
        params.push(grantedBy || null);
        await client.query(
            `INSERT INTO user_permissions (user_id, permission_id, granted, granted_by)
             VALUES ${values}`,
            params
        );
    }

    return {
        added: desiredPerms.length,
        denied: deniedPerms.length,
        cleared: all.length === 0,
        skipped,
    };
}

module.exports = {
    resolveEffectivePermissions,
    reconcileUserPermissions,
};
