const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSqlStatements, RENAME_SHIM } = require('../db/migrate');

test('splitSqlStatements splits simple statements on top-level ;', () => {
    const sql = `CREATE TABLE foo (id INT); INSERT INTO foo VALUES (1); SELECT 1;`;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 3);
    assert.match(out[0], /^CREATE TABLE foo/);
    assert.match(out[2], /^SELECT 1$/);
});

test('splitSqlStatements ignores ; inside single-quoted strings', () => {
    const sql = `INSERT INTO t (s) VALUES ('hello; world'); SELECT 'a;b' AS x;`;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.match(out[0], /'hello; world'/);
    assert.match(out[1], /'a;b'/);
});

test('splitSqlStatements ignores ; inside dollar-quoted blocks', () => {
    const sql = `
        CREATE FUNCTION f() RETURNS void AS $$
        BEGIN
            RAISE NOTICE 'one;two;three';
            PERFORM 1;
        END;
        $$ LANGUAGE plpgsql;
        SELECT f();
    `;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.match(out[0], /CREATE FUNCTION/);
    assert.match(out[0], /\$\$ LANGUAGE plpgsql$/);
    assert.equal(out[1], 'SELECT f()');
});

test('splitSqlStatements supports tagged dollar quotes ($body$ ... $body$)', () => {
    const sql = `DO $body$ BEGIN PERFORM 1; END; $body$; SELECT 99;`;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.match(out[0], /^DO \$body\$/);
    assert.match(out[0], /\$body\$$/);
    assert.equal(out[1], 'SELECT 99');
});

test('splitSqlStatements ignores ; inside line and block comments', () => {
    const sql = `
        -- a comment with ;
        SELECT 1;
        /* block;with;semis */
        SELECT 2;
    `;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.equal(out[0].trim().endsWith('SELECT 1'), true);
    assert.equal(out[1].trim().endsWith('SELECT 2'), true);
});

test('splitSqlStatements drops empty trailing statements', () => {
    const sql = `SELECT 1;;;\n\n   ;`;
    const out = splitSqlStatements(sql);
    assert.deepEqual(out, ['SELECT 1']);
});

test('migrate rename shim covers legacy collision filenames', () => {
    assert.equal(RENAME_SHIM['004_enterprise_skeleton.sql'], '004a_enterprise_skeleton.sql');
    assert.equal(RENAME_SHIM['004_notifications.sql'], '004b_notifications.sql');
    assert.equal(RENAME_SHIM['005_add_inventory_columns.sql'], '005a_add_inventory_columns.sql');
    assert.equal(RENAME_SHIM['005_system_settings.sql'], '005b_system_settings.sql');
});
