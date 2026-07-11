/**
 * Playwright e2e smoke for the v1.0.17 permission-override badges
 * (Settings → Users).
 *
 * Validates what architect review couldn't:
 *   • Per-row "Role default / N overrides / Full access" pill renders
 *     correctly for EVERY user in the table without clipping.
 *   • Clicking the pill jumps the user-edit modal to the Access tab.
 *   • Toggling a default-checked permission flips its row to
 *     "− override" and bumps the live "M overrides" summary.
 *   • Toggling a denied permission on flips it to "+ override".
 *   • "Reset to role" wipes every override badge live (every remaining
 *     badge reads "default") and the summary returns to "no overrides".
 *   • Closing the modal without saving leaves the table pill alone.
 *   • Badges stay aligned with the verb name even when the permission
 *     description wraps onto a second line — exercised by injecting
 *     CSS that forces every description to wrap.
 *
 * Auto-skips when DATABASE_URL is unset (matches the existing
 * smoke.jest.test.js pattern so dev machines without postgres can
 * still run the rest of the suite).
 */
const { test, expect } = require('@playwright/test');

const HAS_DB = !!process.env.DATABASE_URL;

test.describe('override badges (Settings → Users)', () => {
    test.skip(!HAS_DB, 'DATABASE_URL not set — skipping e2e suite');

    test('director can flip badges, reset, and close without saving', async ({ page }) => {
        // ── Login ────────────────────────────────────────────────
        await page.goto('/');
        await page.fill('#login-username', 'director');
        await page.fill('#login-password', 'admin123');
        await Promise.all([
            page.waitForFunction(() =>
                document.getElementById('app-shell') &&
                !document.getElementById('app-shell').classList.contains('hidden')
            ),
            page.click('#login-btn'),
        ]);

        // ── Open Users page ─────────────────────────────────────
        await page.evaluate(() => { window.location.hash = '#/users'; });
        await page.waitForSelector('#users-table-body tr', { timeout: 15_000 });

        // Pull every user the table is showing along with the pill it
        // ended up rendering, then re-derive the expected pill from
        // (user.role, user.override_count) — the same logic
        // renderUserTable() uses — and assert every row matches.
        // Also asserts the pill button is fully visible inside its
        // <tr> (not clipped or wrapped to a 2nd line).
        const rowAudit = await page.evaluate(() => {
            const allUsers = (window.Users && window.Users.allUsers) || [];
            const trs = Array.from(document.querySelectorAll('#users-table-body tr'));
            return trs.map((tr) => {
                const username = (tr.querySelector('.text-white\\/50')?.textContent || '')
                    .replace(/^@/, '').trim();
                const u = allUsers.find((x) => x.username === username) || null;
                const pill = tr.querySelector('.user-perm-pill');
                const btn  = tr.querySelector('.user-perm-pill-btn');
                if (!pill || !btn || !u) return { username, ok: false, reason: 'pill/user missing' };
                const cls = pill.className;
                const text = pill.textContent.trim();
                const r = btn.getBoundingClientRect();
                const rowR = tr.getBoundingClientRect();
                const fits = r.width > 20 && r.height > 0
                    && r.bottom <= rowR.bottom + 1 && r.top >= rowR.top - 1
                    && r.right <= rowR.right + 1;
                return {
                    username,
                    role: u.role,
                    overrideCount: u.override_count || 0,
                    cls,
                    text,
                    fits,
                };
            });
        });

        expect(rowAudit.length).toBeGreaterThan(0);
        for (const row of rowAudit) {
            expect(row, `row ${row.username}`).toMatchObject({ fits: true });
            if (row.role === 'director') {
                expect(row.cls).toMatch(/is-director/);
                expect(row.text).toMatch(/Full access/i);
            } else if (row.overrideCount > 0) {
                expect(row.cls).toMatch(/is-override/);
                const word = row.overrideCount === 1 ? 'override' : 'overrides';
                expect(row.text).toBe(`${row.overrideCount} ${word}`);
            } else {
                expect(row.cls).toMatch(/is-default/);
                expect(row.text).toMatch(/Role default/i);
            }
        }

        // Pick a deterministic non-director "Role default" row for the
        // toggle/reset assertions below.
        const defaultRow = rowAudit.find((r) =>
            r.role !== 'director' && r.overrideCount === 0
        );
        expect(defaultRow, 'need at least one non-director Role-default user').toBeTruthy();
        const targetRow = page.locator(`#users-table-body tr`)
            .filter({ has: page.locator(`.text-white\\/50:has-text("@${defaultRow.username}")`) })
            .first();
        const tablePillBefore = (await targetRow.locator('.user-perm-pill').innerText()).trim();
        expect(tablePillBefore).toMatch(/Role default/i);

        // ── Open Access tab via the pill ─────────────────────────
        await targetRow.locator('.user-perm-pill-btn').click();
        await page.waitForSelector('#user-modal:not(.hidden)');
        await expect(page.locator('[data-modal-tab="access"].user-modal-tab.active'))
            .toBeVisible();
        await expect(page.locator('#user-perms-block')).not.toHaveClass(/hidden/);
        await expect(page.locator('#user-perms-summary'))
            .toContainText(/no overrides/i);

        // ── Force-wrap descriptions and assert badge alignment ───
        // Constrain every description box to a tiny width so the
        // descriptive text wraps to ≥2 lines, then verify the badge
        // still sits inline with the verb name on the first row.
        // Catches the regression flagged in the task description
        // (badge misalignment when descriptions wrap).
        await page.addStyleTag({
            content: `
                #user-perms-grid .perm-item .text-xs.text-white\\/50 { max-width: 80px !important; }
            `,
        });
        const wrapAlignment = await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll(
                'label.perm-item.perm-state-default'
            ));
            const wrapped = labels.find((l) => {
                const desc = l.querySelector('.text-xs.text-white\\/50');
                if (!desc) return false;
                // ≥2 lines = description height > 1.5x line-height-ish.
                return desc.getBoundingClientRect().height > 24;
            });
            if (!wrapped) return { found: false };
            const verbRow = wrapped.querySelector('.flex.items-center.gap-2');
            const badge   = wrapped.querySelector('.perm-state-badge');
            const desc    = wrapped.querySelector('.text-xs.text-white\\/50');
            if (!verbRow || !badge || !desc) return { found: true, ok: false };
            const v = verbRow.getBoundingClientRect();
            const b = badge.getBoundingClientRect();
            const d = desc.getBoundingClientRect();
            return {
                found: true,
                ok: b.top >= v.top - 1 && b.bottom <= v.bottom + 1
                    && b.bottom <= d.top + 1, // badge sits above the wrapped desc
                descLines: Math.round(d.height / 16),
            };
        });
        expect(wrapAlignment.found, 'expected at least one wrapped-description default row').toBe(true);
        expect(wrapAlignment.ok, `badge misaligned with wrapped description (${wrapAlignment.descLines} lines)`).toBe(true);

        // ── Toggle a default permission OFF → "− override" ───────
        const defaultCheckbox = page.locator(
            'label.perm-item.perm-state-default input.user-perm-checkbox[data-perm-default="1"]'
        ).first();
        await defaultCheckbox.scrollIntoViewIfNeeded();
        const togglePermName = await defaultCheckbox.getAttribute('data-perm-name');
        await defaultCheckbox.click();
        const flippedRow = page.locator(
            `label.perm-item:has(input[data-perm-name="${togglePermName}"])`
        );
        await expect(flippedRow).toHaveClass(/perm-state-override-revoke/);
        await expect(flippedRow.locator('.perm-state-badge.state-revoke'))
            .toHaveText(/− override/);
        await expect(page.locator('#user-perms-summary')).toContainText(/1 override\b/);

        // ── Toggle a denied permission ON → "+ override" ─────────
        const deniedCheckbox = page.locator(
            'label.perm-item.perm-state-denied input.user-perm-checkbox[data-perm-default="0"]'
        ).first();
        await deniedCheckbox.scrollIntoViewIfNeeded();
        const grantPermName = await deniedCheckbox.getAttribute('data-perm-name');
        await deniedCheckbox.click();
        const grantedRow = page.locator(
            `label.perm-item:has(input[data-perm-name="${grantPermName}"])`
        );
        await expect(grantedRow).toHaveClass(/perm-state-override-grant/);
        await expect(grantedRow.locator('.perm-state-badge.state-grant'))
            .toHaveText(/\+ override/);
        await expect(page.locator('#user-perms-summary')).toContainText(/2 overrides/);

        // ── Reset to role defaults ───────────────────────────────
        await page.locator('button[data-on-click="Users.resetPermsToRoleDefaults()"]').click();
        await expect(page.locator('#user-perms-summary')).toContainText(/no overrides/i);
        // No override-state rows or badges remain.
        await expect(page.locator('label.perm-item.perm-state-override-grant')).toHaveCount(0);
        await expect(page.locator('label.perm-item.perm-state-override-revoke')).toHaveCount(0);
        await expect(page.locator('.perm-state-badge.state-grant')).toHaveCount(0);
        await expect(page.locator('.perm-state-badge.state-revoke')).toHaveCount(0);
        // Every remaining badge reads exactly "default".
        const postResetBadges = await page.evaluate(() => {
            const badges = Array.from(document.querySelectorAll('#user-perms-grid .perm-state-badge'));
            return {
                count: badges.length,
                allDefault: badges.every((b) =>
                    b.classList.contains('state-default') && b.textContent.trim() === 'default'
                ),
            };
        });
        expect(postResetBadges.count).toBeGreaterThan(0);
        expect(postResetBadges.allDefault).toBe(true);

        // ── Close without saving — table pill is unchanged ───────
        await page.locator('#user-modal button:has-text("Cancel")').first().click();
        await page.waitForSelector('#user-modal.hidden', { timeout: 5_000 });
        await expect(targetRow.locator('.user-perm-pill'))
            .toHaveText(new RegExp(tablePillBefore, 'i'));
    });
});
