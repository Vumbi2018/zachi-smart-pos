#!/usr/bin/env node

const { Pool } = require('pg');

const sourceUrl = process.env.HOSTINGER_DATABASE_URL;
const targetUrl = process.env.STAGING_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
    console.error('HOSTINGER_DATABASE_URL and STAGING_DATABASE_URL are required.');
    process.exit(1);
}

const source = new Pool({ connectionString: sourceUrl });
const target = new Pool({ connectionString: targetUrl });

const stats = {
    usersInserted: 0,
    usersMatched: 0,
    customersInserted: 0,
    customersMatched: 0,
    productsInserted: 0,
    productsMatched: 0,
    servicesInserted: 0,
    servicesMatched: 0,
    salesInserted: 0,
    salesMatched: 0,
    saleItemsInserted: 0,
    auditLogsInserted: 0,
};

function norm(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

async function columnList(client, table) {
    const res = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
    );
    return res.rows.map((row) => row.column_name);
}

async function insertKnown(client, table, row, columns, returningColumn) {
    const keys = columns.filter((col) => Object.prototype.hasOwnProperty.call(row, col));
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const names = keys.map((key) => `"${key}"`).join(', ');
    const values = keys.map((key) => row[key]);
    const returning = returningColumn ? ` RETURNING ${returningColumn}` : '';
    return client.query(`INSERT INTO ${table} (${names}) VALUES (${placeholders})${returning}`, values);
}

async function rows(client, table, orderBy) {
    const res = await client.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    return res.rows;
}

async function main() {
    const targetClient = await target.connect();
    try {
        await targetClient.query('BEGIN');

        const userColumns = await columnList(targetClient, 'users');
        const customerColumns = await columnList(targetClient, 'customers');
        const productColumns = await columnList(targetClient, 'products');
        const serviceColumns = await columnList(targetClient, 'services');
        const saleColumns = await columnList(targetClient, 'sales');
        const saleItemColumns = await columnList(targetClient, 'sale_items');
        const auditColumns = await columnList(targetClient, 'audit_logs');

        const userMap = new Map();
        const targetUsers = await rows(targetClient, 'users', 'username');
        const targetUsersByUsername = new Map(targetUsers.map((row) => [norm(row.username), row]));
        for (const row of await rows(source, 'users', 'username')) {
            const match = targetUsersByUsername.get(norm(row.username));
            if (match) {
                userMap.set(row.user_id, match.user_id);
                stats.usersMatched += 1;
                continue;
            }
            const insertRow = { ...row };
            delete insertRow.user_id;
            const inserted = await insertKnown(targetClient, 'users', insertRow, userColumns, 'user_id');
            userMap.set(row.user_id, inserted.rows[0].user_id);
            stats.usersInserted += 1;
        }

        const customerMap = new Map();
        const targetCustomers = await rows(targetClient, 'customers', 'full_name');
        const targetCustomersByPhone = new Map(targetCustomers.filter((r) => hasValue(r.phone)).map((r) => [norm(r.phone), r]));
        const targetCustomersByEmail = new Map(targetCustomers.filter((r) => hasValue(r.email)).map((r) => [norm(r.email), r]));
        const targetCustomersByName = new Map(targetCustomers.map((r) => [norm(r.full_name), r]));
        for (const row of await rows(source, 'customers', 'full_name')) {
            const match =
                (hasValue(row.phone) && targetCustomersByPhone.get(norm(row.phone))) ||
                (hasValue(row.email) && targetCustomersByEmail.get(norm(row.email))) ||
                targetCustomersByName.get(norm(row.full_name));
            if (match) {
                customerMap.set(row.customer_id, match.customer_id);
                stats.customersMatched += 1;
                continue;
            }
            const insertRow = { ...row };
            delete insertRow.customer_id;
            const inserted = await insertKnown(targetClient, 'customers', insertRow, customerColumns, 'customer_id');
            customerMap.set(row.customer_id, inserted.rows[0].customer_id);
            stats.customersInserted += 1;
        }

        const productMap = new Map();
        const targetProducts = await rows(targetClient, 'products', 'name');
        const targetProductsByBarcode = new Map(targetProducts.filter((r) => hasValue(r.barcode)).map((r) => [norm(r.barcode), r]));
        const targetProductsByName = new Map(targetProducts.map((r) => [norm(r.name), r]));
        for (const row of await rows(source, 'products', 'name')) {
            const match =
                (hasValue(row.barcode) && targetProductsByBarcode.get(norm(row.barcode))) ||
                targetProductsByName.get(norm(row.name));
            if (match) {
                productMap.set(row.product_id, match.product_id);
                stats.productsMatched += 1;
                continue;
            }
            const insertRow = { ...row };
            delete insertRow.product_id;
            const inserted = await insertKnown(targetClient, 'products', insertRow, productColumns, 'product_id');
            productMap.set(row.product_id, inserted.rows[0].product_id);
            stats.productsInserted += 1;
        }

        const serviceMap = new Map();
        const targetServices = await rows(targetClient, 'services', 'service_name');
        const targetServicesByKey = new Map(targetServices.map((r) => [`${norm(r.service_name)}|${norm(r.category)}`, r]));
        for (const row of await rows(source, 'services', 'service_name')) {
            const key = `${norm(row.service_name)}|${norm(row.category)}`;
            const match = targetServicesByKey.get(key);
            if (match) {
                serviceMap.set(row.service_id, match.service_id);
                stats.servicesMatched += 1;
                continue;
            }
            const insertRow = { ...row };
            delete insertRow.service_id;
            const inserted = await insertKnown(targetClient, 'services', insertRow, serviceColumns, 'service_id');
            serviceMap.set(row.service_id, inserted.rows[0].service_id);
            stats.servicesInserted += 1;
        }

        const saleMap = new Map();
        const insertedSourceSaleIds = new Set();
        const existingSales = await targetClient.query('SELECT sale_id, sale_number FROM sales');
        const targetSalesByNumber = new Map(existingSales.rows.filter((r) => hasValue(r.sale_number)).map((r) => [norm(r.sale_number), r]));
        for (const row of await rows(source, 'sales', 'transaction_date NULLS FIRST, sale_number')) {
            const match = hasValue(row.sale_number) ? targetSalesByNumber.get(norm(row.sale_number)) : null;
            if (match) {
                saleMap.set(row.sale_id, match.sale_id);
                stats.salesMatched += 1;
                continue;
            }
            const insertRow = {
                ...row,
                customer_id: row.customer_id ? customerMap.get(row.customer_id) || null : null,
                staff_id: row.staff_id ? userMap.get(row.staff_id) || null : null,
                voided_by: row.voided_by ? userMap.get(row.voided_by) || null : null,
            };
            delete insertRow.sale_id;
            const inserted = await insertKnown(targetClient, 'sales', insertRow, saleColumns, 'sale_id');
            saleMap.set(row.sale_id, inserted.rows[0].sale_id);
            insertedSourceSaleIds.add(row.sale_id);
            stats.salesInserted += 1;
        }

        for (const row of await rows(source, 'sale_items', 'sale_id, item_id')) {
            if (!insertedSourceSaleIds.has(row.sale_id)) continue;
            const productId = row.product_id ? productMap.get(row.product_id) || null : null;
            const serviceId = row.service_id ? serviceMap.get(row.service_id) || null : null;
            let itemType = row.item_type;
            if (itemType === 'product' && !productId) itemType = 'custom';
            if (itemType === 'service' && !serviceId) itemType = 'custom';
            const insertRow = {
                ...row,
                sale_id: saleMap.get(row.sale_id),
                item_type: itemType,
                product_id: itemType === 'product' ? productId : null,
                service_id: itemType === 'service' ? serviceId : null,
            };
            delete insertRow.item_id;
            await insertKnown(targetClient, 'sale_items', insertRow, saleItemColumns);
            stats.saleItemsInserted += 1;
        }

        for (const row of await rows(source, 'audit_logs', 'created_at NULLS FIRST')) {
            const exists = await targetClient.query(
                `SELECT 1 FROM audit_logs
                 WHERE action = $1 AND COALESCE(table_name, '') = COALESCE($2, '')
                   AND COALESCE(record_id::text, '') = COALESCE($3::text, '')
                   AND created_at = $4
                 LIMIT 1`,
                [row.action, row.table_name, row.record_id, row.created_at]
            );
            if (exists.rowCount) continue;
            const insertRow = {
                ...row,
                user_id: row.user_id ? userMap.get(row.user_id) || null : null,
                record_id: row.record_id ? String(row.record_id) : null,
            };
            delete insertRow.log_id;
            await insertKnown(targetClient, 'audit_logs', insertRow, auditColumns);
            stats.auditLogsInserted += 1;
        }

        await targetClient.query(
            "SELECT setval(pg_get_serial_sequence('products', 'product_id'), COALESCE((SELECT MAX(product_id) FROM products), 1), true)"
        );
        await targetClient.query(
            "SELECT setval(pg_get_serial_sequence('services', 'service_id'), COALESCE((SELECT MAX(service_id) FROM services), 1), true)"
        );
        await targetClient.query(
            "SELECT setval(pg_get_serial_sequence('sale_items', 'item_id'), COALESCE((SELECT MAX(item_id) FROM sale_items), 1), true)"
        );

        await targetClient.query('COMMIT');
        console.log(JSON.stringify(stats, null, 2));
    } catch (error) {
        await targetClient.query('ROLLBACK').catch(() => {});
        console.error(error);
        process.exitCode = 1;
    } finally {
        targetClient.release();
        await source.end();
        await target.end();
    }
}

main();
