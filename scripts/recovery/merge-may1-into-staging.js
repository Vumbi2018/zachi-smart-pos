#!/usr/bin/env node

const { Pool } = require('pg');

const sourceUrl = process.env.MAY1_DATABASE_URL;
const targetUrl = process.env.STAGING_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
    console.error('MAY1_DATABASE_URL and STAGING_DATABASE_URL are required.');
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
    notificationsInserted: 0,
};

function norm(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
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

async function insertKnown(client, table, row, columns) {
    const keys = columns.filter((col) => Object.prototype.hasOwnProperty.call(row, col));
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const names = keys.map((key) => `"${key}"`).join(', ');
    const values = keys.map((key) => row[key]);
    const returning = columns.includes(`${table.slice(0, -1)}_id`) ? ` RETURNING ${table.slice(0, -1)}_id` : '';
    return client.query(`INSERT INTO ${table} (${names}) VALUES (${placeholders})${returning}`, values);
}

async function loadUsers(client) {
    const res = await client.query('SELECT * FROM users ORDER BY created_at NULLS FIRST, username');
    return res.rows;
}

async function loadCustomers(client) {
    const res = await client.query('SELECT * FROM customers ORDER BY created_at NULLS FIRST, full_name');
    return res.rows;
}

async function loadProducts(client) {
    const res = await client.query('SELECT * FROM products ORDER BY created_at NULLS FIRST, name');
    return res.rows;
}

async function loadServices(client) {
    const res = await client.query('SELECT * FROM services ORDER BY created_at NULLS FIRST, service_name');
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
        const notificationColumns = await columnList(targetClient, 'notifications');

        const userMap = new Map();
        const targetUsers = await loadUsers(targetClient);
        const targetUsersByUsername = new Map(targetUsers.map((row) => [norm(row.username), row]));
        for (const row of await loadUsers(source)) {
            const match = targetUsersByUsername.get(norm(row.username));
            if (match) {
                userMap.set(row.user_id, match.user_id);
                stats.usersMatched += 1;
                continue;
            }
            await insertKnown(targetClient, 'users', row, userColumns);
            targetUsersByUsername.set(norm(row.username), row);
            userMap.set(row.user_id, row.user_id);
            stats.usersInserted += 1;
        }

        const customerMap = new Map();
        const targetCustomers = await loadCustomers(targetClient);
        const targetCustomersByPhone = new Map(targetCustomers.filter((r) => hasValue(r.phone)).map((r) => [norm(r.phone), r]));
        const targetCustomersByEmail = new Map(targetCustomers.filter((r) => hasValue(r.email)).map((r) => [norm(r.email), r]));
        const targetCustomersByName = new Map(targetCustomers.map((r) => [norm(r.full_name), r]));
        for (const row of await loadCustomers(source)) {
            const match =
                (hasValue(row.phone) && targetCustomersByPhone.get(norm(row.phone))) ||
                (hasValue(row.email) && targetCustomersByEmail.get(norm(row.email))) ||
                targetCustomersByName.get(norm(row.full_name));
            if (match) {
                customerMap.set(row.customer_id, match.customer_id);
                stats.customersMatched += 1;
                continue;
            }
            await insertKnown(targetClient, 'customers', row, customerColumns);
            customerMap.set(row.customer_id, row.customer_id);
            stats.customersInserted += 1;
        }

        const productMap = new Map();
        const targetProducts = await loadProducts(targetClient);
        const targetProductsByBarcode = new Map(targetProducts.filter((r) => hasValue(r.barcode)).map((r) => [norm(r.barcode), r]));
        const targetProductsByName = new Map(targetProducts.map((r) => [norm(r.name), r]));
        for (const row of await loadProducts(source)) {
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
            const inserted = await insertKnown(targetClient, 'products', insertRow, productColumns);
            const productId = inserted.rows[0]?.product_id;
            productMap.set(row.product_id, productId);
            targetProductsByName.set(norm(row.name), { ...row, product_id: productId });
            stats.productsInserted += 1;
        }

        const serviceMap = new Map();
        const targetServices = await loadServices(targetClient);
        const targetServicesByKey = new Map(targetServices.map((r) => [`${norm(r.service_name)}|${norm(r.category)}`, r]));
        for (const row of await loadServices(source)) {
            const key = `${norm(row.service_name)}|${norm(row.category)}`;
            const match = targetServicesByKey.get(key);
            if (match) {
                serviceMap.set(row.service_id, match.service_id);
                stats.servicesMatched += 1;
                continue;
            }
            const insertRow = { ...row };
            delete insertRow.service_id;
            const inserted = await insertKnown(targetClient, 'services', insertRow, serviceColumns);
            const serviceId = inserted.rows[0]?.service_id;
            serviceMap.set(row.service_id, serviceId);
            stats.servicesInserted += 1;
        }

        const saleMap = new Map();
        const insertedSaleIds = new Set();
        const targetSales = await targetClient.query('SELECT sale_id, sale_number FROM sales');
        const targetSalesByNumber = new Map(targetSales.rows.filter((r) => hasValue(r.sale_number)).map((r) => [norm(r.sale_number), r]));
        const sourceSales = await source.query('SELECT * FROM sales ORDER BY transaction_date NULLS FIRST, sale_number');
        for (const row of sourceSales.rows) {
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
            await insertKnown(targetClient, 'sales', insertRow, saleColumns);
            saleMap.set(row.sale_id, row.sale_id);
            insertedSaleIds.add(row.sale_id);
            stats.salesInserted += 1;
        }

        const sourceItems = await source.query('SELECT * FROM sale_items ORDER BY sale_id, description');
        for (const row of sourceItems.rows) {
            const targetSaleId = saleMap.get(row.sale_id);
            if (!targetSaleId || !insertedSaleIds.has(row.sale_id)) continue;

            const productId = row.product_id ? productMap.get(row.product_id) || null : null;
            const serviceId = row.service_id ? serviceMap.get(row.service_id) || null : null;
            let itemType = row.item_type;
            if (itemType === 'product' && !productId) itemType = 'custom';
            if (itemType === 'service' && !serviceId) itemType = 'custom';

            const insertRow = {
                ...row,
                sale_id: targetSaleId,
                item_type: itemType,
                product_id: itemType === 'product' ? productId : null,
                service_id: itemType === 'service' ? serviceId : null,
            };
            delete insertRow.item_id;
            await insertKnown(targetClient, 'sale_items', insertRow, saleItemColumns);
            stats.saleItemsInserted += 1;
        }

        const sourceAudits = await source.query('SELECT * FROM audit_logs ORDER BY created_at NULLS FIRST');
        for (const row of sourceAudits.rows) {
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

        const sourceNotifications = await source.query('SELECT * FROM notifications ORDER BY created_at NULLS FIRST');
        for (const row of sourceNotifications.rows) {
            const exists = await targetClient.query(
                `SELECT 1 FROM notifications
                 WHERE COALESCE(user_id::text, '') = COALESCE($1::text, '')
                   AND type = $2 AND message = $3 AND created_at = $4
                 LIMIT 1`,
                [row.user_id ? userMap.get(row.user_id) || null : null, row.type, row.message, row.created_at]
            );
            if (exists.rowCount) continue;
            const insertRow = {
                ...row,
                user_id: row.user_id ? userMap.get(row.user_id) || null : null,
                related_id: row.related_id ? String(row.related_id) : null,
            };
            delete insertRow.id;
            await insertKnown(targetClient, 'notifications', insertRow, notificationColumns);
            stats.notificationsInserted += 1;
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

