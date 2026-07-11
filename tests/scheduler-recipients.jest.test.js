/**
 * Jest unit test for jobs/scheduler.js → getNotificationRecipients().
 *
 * Guards the case-insensitive de-dup behaviour: when a director's email
 * is also present (in any casing) in the notifications.recipients
 * system_setting, the merged list must yield exactly one recipient
 * entry. Without this guard a director who adds their own personal
 * address to the recipients list (a likely first move) would receive
 * every low-stock and credit-reminder email twice.
 */

jest.mock('../db/pool', () => ({
    query: jest.fn(),
}));

const pool = require('../db/pool');
const { getNotificationRecipients } = require('../jobs/scheduler');

function mockQueries({ directors, recipientsSetting }) {
    pool.query.mockReset();
    pool.query.mockImplementation((sql) => {
        const text = String(sql || '');
        if (/FROM\s+users/i.test(text) && /role\s*=\s*'director'/i.test(text)) {
            return Promise.resolve({ rows: directors });
        }
        if (/FROM\s+system_settings/i.test(text) && /notifications\.recipients/.test(text)) {
            return Promise.resolve({ rows: recipientsSetting });
        }
        return Promise.resolve({ rows: [] });
    });
}

describe('getNotificationRecipients()', () => {
    test('director email plus same address in recipients yields a single recipient (case-insensitive)', async () => {
        mockQueries({
            directors: [{ email: 'Alice@Example.com', full_name: 'Alice' }],
            recipientsSetting: [
                { setting_value: ['alice@example.com', { email: 'ops@example.com', name: 'Ops' }] },
            ],
        });

        const out = await getNotificationRecipients();

        const lowered = out.map((r) => r.email.toLowerCase());
        expect(lowered.filter((e) => e === 'alice@example.com')).toHaveLength(1);
        expect(out).toHaveLength(2);
        expect(lowered.sort()).toEqual(['alice@example.com', 'ops@example.com']);
    });

    test('multiple directors plus an overlapping recipients list still de-dupe across the whole merged set', async () => {
        mockQueries({
            directors: [
                { email: 'a@x.com', full_name: 'A' },
                { email: 'B@X.com', full_name: 'B' },
                { email: 'a@x.com', full_name: 'A dup' }, // duplicate within directors
            ],
            recipientsSetting: [
                { setting_value: [
                    'A@X.COM',                                  // dup of director A
                    { email: 'b@x.com', name: 'B extra' },      // dup of director B
                    { email: '  c@x.com  ', name: 'C' },        // new, with whitespace
                    '',                                          // empty string skipped
                    null,                                        // null skipped
                ] },
            ],
        });

        const out = await getNotificationRecipients();

        const lowered = out.map((r) => r.email.toLowerCase());
        expect(lowered.sort()).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
        expect(out.find((r) => r.email.toLowerCase() === 'c@x.com').email).toBe('c@x.com');
    });

    test('directors-only path (no recipients setting row) returns the director list de-duped', async () => {
        mockQueries({
            directors: [
                { email: 'one@example.com', full_name: 'One' },
                { email: 'ONE@example.com', full_name: 'One again' },
            ],
            recipientsSetting: [], // no settings row
        });

        const out = await getNotificationRecipients();
        expect(out).toHaveLength(1);
        expect(out[0].email).toBe('one@example.com');
    });
});
