const pool = require('../db/pool');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Helper to record movement
async function recordMovement(pool, productId, type, quantity, balance, reason, performedBy, refType = 'manual', refId = null) {
    if (quantity === 0) return;
    try {
        await pool.query(`
            INSERT INTO inventory_movements (product_id, movement_type, quantity, balance_after, reason, performed_by, reference_type, reference_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [productId, type, quantity, balance, reason, performedBy, refType, refId]);
    } catch (err) {
        console.error('Failed to record movement:', err);
        // Don't block main operation
    }
}

/**
 * GET /api/products
 * List products with search, filter, and pagination
 */
async function listProducts(req, res) {
    try {
        const { search, category, page = 1, limit = 50, low_stock } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        const conditions = ['is_active = TRUE'];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(name ILIKE $${params.length} OR barcode ILIKE $${params.length})`);
        }

        if (category) {
            params.push(category);
            conditions.push(`category = $${params.length}`);
        }

        if (low_stock === 'true') {
            conditions.push('stock_quantity <= reorder_level');
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(`SELECT COUNT(*) FROM products ${where}`, params);
        const total = parseInt(countResult.rows[0].count, 10);

        params.push(limit);
        params.push(offset);
        const result = await pool.query(
            `SELECT * FROM products ${where} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            products: result.rows,
            pagination: { page: parseInt(page), limit: parseInt(limit), total }
        });
    } catch (err) {
        console.error('List products error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/products/:id
 */
async function getProduct(req, res) {
    try {
        const result = await pool.query('SELECT * FROM products WHERE product_id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get product error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/products/barcode/:code
 */
async function getByBarcode(req, res) {
    try {
        const result = await pool.query('SELECT * FROM products WHERE barcode = $1 AND is_active = TRUE', [req.params.code]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found for this barcode.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Barcode lookup error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/products
 */
async function createProduct(req, res) {
    try {
        const { barcode, name, description, category, unit_price, cost_price, stock_quantity, reorder_level, unit_of_measure, items_per_pack, remarks } = req.body;

        if (!name || !unit_price) {
            return res.status(400).json({ error: 'Name and unit_price are required.' });
        }

        const result = await pool.query(
            `INSERT INTO products (barcode, name, description, category, unit_price, cost_price, stock_quantity, reorder_level, unit_of_measure, items_per_pack, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
            [barcode || null, name, description || null, category || null, unit_price,
            cost_price || null, stock_quantity || 0, reorder_level || 10, unit_of_measure || 'piece', items_per_pack || 1, remarks || null]
        );

        const newProduct = result.rows[0];

        // Record initial stock movement
        if (newProduct.stock_quantity > 0) {
            await recordMovement(pool, newProduct.product_id, 'IN', newProduct.stock_quantity, newProduct.stock_quantity, 'Initial Stock', req.user.user_id, 'initial_stock');
        }

        res.status(201).json(newProduct);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'A product with this barcode already exists.' });
        }
        console.error('Create product error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * PUT /api/products/:id
 */
async function updateProduct(req, res) {
    try {
        const { barcode, name, description, category, unit_price, cost_price, stock_quantity, reorder_level, unit_of_measure, items_per_pack, remarks } = req.body;
        const productId = req.params.id;

        // Store old value for audit
        const old = await pool.query('SELECT * FROM products WHERE product_id = $1', [productId]);
        if (old.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found.' });
        }
        req._auditOldValue = old.rows[0];
        const oldQty = old.rows[0].stock_quantity;
        const newQty = parseInt(stock_quantity);

        const result = await pool.query(
            `UPDATE products SET
        barcode = COALESCE($1, barcode),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        category = COALESCE($4, category),
        unit_price = COALESCE($5, unit_price),
        cost_price = COALESCE($6, cost_price),
        stock_quantity = COALESCE($7, stock_quantity),
        reorder_level = COALESCE($8, reorder_level),
        unit_of_measure = COALESCE($9, unit_of_measure),
        items_per_pack = COALESCE($10, items_per_pack),
        remarks = COALESCE($11, remarks),
        updated_at = CURRENT_TIMESTAMP
       WHERE product_id = $12 RETURNING *`,
            [barcode, name, description, category, unit_price, cost_price, stock_quantity, reorder_level, unit_of_measure, items_per_pack, remarks, productId]
        );

        const updatedProduct = result.rows[0];

        // Record movement if quantity changed manually via edit
        if (!isNaN(newQty) && newQty !== oldQty) {
            const diff = newQty - oldQty;
            const type = diff > 0 ? 'IN' : 'out'; // or 'ADJUSTMENT'
            await recordMovement(pool, productId, 'ADJUSTMENT', Math.abs(diff), newQty, 'Manual Edit', req.user.user_id, 'edit');
        }

        res.json(updatedProduct);
    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * DELETE /api/products/:id (soft delete)
 */
async function deleteProduct(req, res) {
    try {
        const result = await pool.query(
            'UPDATE products SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 RETURNING product_id, name',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        res.json({ message: 'Product deleted.', product: result.rows[0] });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}



/**
 * GET /api/products/alerts/low-stock
 */
async function lowStockAlerts(req, res) {
    try {
        const result = await pool.query(
            `SELECT product_id, name, category, stock_quantity, reorder_level,
              (reorder_level - stock_quantity) AS shortage
       FROM products
       WHERE stock_quantity <= reorder_level AND is_active = TRUE
       ORDER BY shortage DESC`
        );

        res.json({ alerts: result.rows, count: result.rows.length });
    } catch (err) {
        console.error('Low stock error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/products/categories
 */
async function getCategories(req, res) {
    try {
        const result = await pool.query(
            'SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND is_active = TRUE ORDER BY category'
        );
        res.json(result.rows.map(r => r.category));
    } catch (err) {
        console.error('Categories error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/products/import
 */
async function importProducts(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: 'Please upload a CSV file.' });
    }

    const results = [];
    const errors = [];
    let importedCount = 0;
    let updatedCount = 0;

    console.log('[Import] Starting import process...');
    console.log('[Import] File info:', {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
    });

    // Helper to validate and default values
    const processRow = async (row) => {
        // Normalize headers based on user's specific list format
        // Mapping aliases to internal fields
        const name = row.name || row.description || row['product name'] || row['item name'];
        const unit_price = row.unit_price || row['selling price'] || row.price || row['unit price'];
        const cost_price = row.cost_price || row['buying price'] || row['cost'];
        const barcode = row.barcode || row.code || row['bar code'] || row.sku;
        const stock_quantity = row.stock_quantity || row['total qty'] || row.qty || row.quantity || row['stock'];
        const reorder_level = row.reorder_level || row['reorder'] || row['min stock'];
        const unit_of_measure = row.unit_of_measure || row.uom || row.unit;
        const items_per_pack = row.items_per_pack || row['unit qty'] || row['pack size'];
        const remarks = row.remarks || row.notes || row.note;
        const category = row.category || row.type || row.group;
        const description = row.description;

        console.log('[Import] Processing row:', {
            name, barcode, stock_quantity, unit_price,
            original_row: row
        });

        // Check for existing product by barcode (priority) or name
        let existing = null;
        try {
            // IGNORE placeholder barcodes from templates for matching
            const isPlaceholder = barcode === '123456789' || barcode === '000000000';

            if (barcode && !isPlaceholder) {
                const res = await pool.query('SELECT * FROM products WHERE barcode = $1 AND is_active = TRUE', [barcode]);
                existing = res.rows[0];
            }
            if (!existing && name) {
                const res = await pool.query('SELECT * FROM products WHERE name = $1 AND is_active = TRUE', [name]);
                existing = res.rows[0];
            }

            if (existing) {
                console.log(`[Import] Matched existing product: "${existing.name}" (ID: ${existing.product_id})`);
                // Update existing
                const oldQty = existing.stock_quantity;
                const addedStock = parseInt(stock_quantity) || 0;
                const finalQty = oldQty + addedStock;

                await pool.query(
                    `UPDATE products SET 
                     stock_quantity = stock_quantity + $1,
                     unit_price = COALESCE($2, unit_price),
                     cost_price = COALESCE($3, cost_price),
                     items_per_pack = COALESCE($4, items_per_pack),
                     remarks = COALESCE($5, remarks),
                     category = COALESCE($6, category),
                     description = COALESCE($7, description),
                     reorder_level = COALESCE($8, reorder_level),
                     unit_of_measure = COALESCE($9, unit_of_measure),
                     updated_at = CURRENT_TIMESTAMP
                     WHERE product_id = $10`,
                    [
                        addedStock,
                        unit_price ? parseFloat(unit_price) : null,
                        cost_price ? parseFloat(cost_price) : null,
                        items_per_pack ? parseInt(items_per_pack) : null,
                        remarks || null,
                        category || null,
                        description || null,
                        reorder_level ? parseInt(reorder_level) : null,
                        unit_of_measure || null,
                        existing.product_id
                    ]
                );

                if (addedStock !== 0) {
                    await recordMovement(pool, existing.product_id, 'IN', addedStock, finalQty, 'Import Update', req.user.user_id, 'import');
                }
                updatedCount++;
            } else {
                // For NEW products, name and unit_price are strictly required
                if (!name || !unit_price) {
                    errors.push({ row, error: 'Name and Selling Price are required for new products.' });
                    return;
                }

                // Insert new
                const initStock = parseInt(stock_quantity) || 0;
                const insertRes = await pool.query(
                    `INSERT INTO products (barcode, name, description, category, unit_price, cost_price, stock_quantity, reorder_level, unit_of_measure, items_per_pack, remarks)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     RETURNING product_id`,
                    [
                        barcode || null,
                        name,
                        description || null,
                        category || null,
                        parseFloat(unit_price),
                        cost_price ? parseFloat(cost_price) : null,
                        initStock,
                        parseInt(reorder_level) || 10,
                        unit_of_measure || 'piece',
                        parseInt(items_per_pack) || 1,
                        remarks || null
                    ]
                );

                const newId = insertRes.rows[0].product_id;
                if (initStock > 0) {
                    await recordMovement(pool, newId, 'IN', initStock, initStock, 'Import Initial', req.user.user_id, 'import');
                }

                importedCount++;
            }
        } catch (err) {
            errors.push({ row, error: err.message });
        }
    };

    // Parse CSV from buffer
    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    bufferStream
        .pipe(csv({
            mapHeaders: ({ header }) => {
                const h = header.replace(/^\ufeff/, '').toLowerCase().trim();
                console.log(`[Import] Mapped header: "${header}" -> "${h}"`);
                return h;
            }
        }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`[Import] Parsed ${results.length} rows from CSV.`);
            for (const row of results) {
                await processRow(row);
            }
            res.json({
                message: 'Import processed.',
                imported: importedCount,
                updated: updatedCount,
                errors: errors.length > 0 ? errors : undefined
            });
        })
        .on('error', (err) => {
            console.error('CSV Parse Error:', err);
            res.status(500).json({ error: 'Failed to process CSV file.' });
        });
}

/**
 * GET /api/products/export
 */
async function exportProducts(req, res) {
    try {
        const result = await pool.query('SELECT * FROM products WHERE is_active = TRUE ORDER BY name');
        const products = result.rows;

        // Manual CSV generation for simplicity without extra huge lib
        const headers = ['barcode', 'name', 'category', 'unit_price', 'cost_price', 'stock_quantity', 'reorder_level', 'unit_of_measure', 'items_per_pack', 'remarks', 'description'];
        const csvRows = [headers.join(',')];

        products.forEach(p => {
            const row = headers.map(header => {
                let val = p[header] || '';
                // Escape quotes and wrap in quotes if contains comma
                if (typeof val === 'string' || typeof val === 'number') {
                    let str = String(val);
                    str = str.replace(/"/g, '""');
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        str = `"${str}"`;
                    }
                    return str;
                }
                return val;
            });
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
        res.send(csvString);

    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/products/import-template
 */
async function getImportTemplate(req, res) {
    try {
        console.log('Generating import template...');
        const headers = ['barcode', 'name', 'category', 'unit_price', 'cost_price', 'stock_quantity', 'reorder_level', 'unit_of_measure', 'items_per_pack', 'remarks', 'description'];
        const exampleRow = ['123456789', 'Example Product', 'Stationery', '15.50', '10.00', '100', '10', 'piece', '1', 'Refillable', 'Example Description'];

        const csvContent = [
            headers.join(','),
            exampleRow.join(',')
        ].join('\n');

        // Explicitly set headers using Express helpers
        res.attachment('inventory_template.csv');
        res.set('Content-Type', 'text/csv');

        // Send as Buffer to ensure correct content length/handling
        const buffer = Buffer.from(csvContent, 'utf-8');
        res.status(200).send(buffer);
        console.log('Template sent successfully.');
    } catch (err) {
        console.error('CRITICAL ERROR in getImportTemplate:', err);
        // FORCE WRITE TO FILE FOR DEBUGGING
        const debugPath = path.join(__dirname, '../debug_template_error.txt');
        fs.writeFileSync(debugPath, `Error at ${new Date()}: ${err.message}\nStack: ${err.stack}\n`);

        // Ensure response hasn't been sent
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate template due to server error.' });
        }
    }
}

/**
 * POST /api/products/bulk-delete
 * Soft-deletes multiple products by ID (sets is_active = false to preserve sales history)
 */
async function bulkDelete(req, res) {
    try {
        const { ids } = req.body; // expects { ids: [1, 2, 3] }
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No product IDs provided.' });
        }
        // Validate all are integers
        const clean = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (clean.length === 0) {
            return res.status(400).json({ error: 'Invalid product IDs.' });
        }

        const placeholders = clean.map((_, i) => `$${i + 1}`).join(', ');
        const result = await pool.query(
            `UPDATE products SET is_active = FALSE, updated_at = NOW()
             WHERE product_id IN (${placeholders}) AND is_active = TRUE
             RETURNING product_id, name`,
            clean
        );

        res.json({
            success: true,
            deleted: result.rowCount,
            products: result.rows
        });
    } catch (err) {
        console.error('bulkDelete error:', err);
        res.status(500).json({ error: 'Failed to delete products.' });
    }
}

/**
 * POST /api/products/bulk-update
 * Applies a partial update (e.g. category, unit_price) to multiple products
 */
async function bulkUpdate(req, res) {
    try {
        const { ids, updates } = req.body; // { ids: [...], updates: { category: 'X', ... } }
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No product IDs provided.' });
        }
        if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No update fields provided.' });
        }

        const allowed = ['category', 'unit_price', 'cost_price', 'reorder_level', 'unit_of_measure', 'is_active'];
        const fields = Object.keys(updates).filter(k => allowed.includes(k));
        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update.' });
        }

        const clean = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
        const setClauses = fields.map((f, i) => `${f} = $${i + 1}`);
        const values = fields.map(f => updates[f]);
        const idPlaceholders = clean.map((_, i) => `$${fields.length + i + 1}`).join(', ');

        const result = await pool.query(
            `UPDATE products SET ${setClauses.join(', ')}, updated_at = NOW()
             WHERE product_id IN (${idPlaceholders}) AND is_active = TRUE
             RETURNING product_id, name`,
            [...values, ...clean]
        );

        res.json({
            success: true,
            updated: result.rowCount,
            products: result.rows
        });
    } catch (err) {
        console.error('bulkUpdate error:', err);
        res.status(500).json({ error: 'Failed to update products.' });
    }
}

module.exports = { listProducts, getProduct, getByBarcode, createProduct, updateProduct, deleteProduct, bulkDelete, bulkUpdate, lowStockAlerts, getCategories, importProducts, exportProducts, getImportTemplate };

