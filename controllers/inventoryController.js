/**
 * Zachi Smart-POS — Inventory Controller
 * Stock visibility, audit trails, and adjustments
 */
const pool = require('../db/pool');
const NotificationController = require('./notificationController');

/** GET /api/inventory — List all products with current stock and value */
async function getInventory(req, res) {
    try {
        const result = await pool.query(`
            SELECT p.product_id, p.name, p.sku, p.barcode, p.category,
                   p.stock_quantity, p.cost_price, p.unit_price,
                   p.unit_of_measure, p.items_per_pack, p.remarks,
                   (p.stock_quantity * p.cost_price) as stock_value,
                   p.reorder_level
            FROM products p
            WHERE p.is_active = true
            ORDER BY p.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Get inventory error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/inventory/:id/movements — Get movement history */
async function getMovements(req, res) {
    try {
        const result = await pool.query(`
            SELECT im.*, u.username as user_name
            FROM inventory_movements im
            LEFT JOIN users u ON im.performed_by = u.user_id
            WHERE im.product_id = $1
            ORDER BY im.created_at DESC
            LIMIT 50
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Get movements error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/inventory/adjust — Manual single-item adjustment */
/** POST /api/inventory/adjust — Manual single-item adjustment */
async function adjustStock(req, res) {
    try {
        const { product_id, adjustment_type, quantity, reason, notes, items_per_pack, remarks } = req.body;
        // adjustment_type: 'increase', 'decrease', 'set'. quantity is absolute number.

        if (!product_id || !adjustment_type || quantity === undefined) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        await pool.query('BEGIN');

        // 1. Get current state
        const p = await pool.query('SELECT stock_quantity, reorder_level, name, sku FROM products WHERE product_id = $1 FOR UPDATE', [product_id]);
        if (p.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found.' });
        }
        const product = p.rows[0];
        const currentQty = product.stock_quantity;
        const targetQty = parseInt(quantity);

        // 2. Calculate delta
        let delta = 0;
        let finalQty = currentQty;

        if (adjustment_type === 'increase') {
            delta = targetQty;
            finalQty = currentQty + delta;
        } else if (adjustment_type === 'decrease') {
            delta = -targetQty;
            finalQty = currentQty + delta;
        } else if (adjustment_type === 'set') {
            delta = targetQty - currentQty;
            finalQty = targetQty;
        } else {
            await pool.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid adjustment type.' });
        }

        if (delta === 0 && !items_per_pack && !remarks) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ error: 'No changes detected.' });
        }

        // 3. Record in stock_adjustments
        // Map 'remarks' from form to 'notes' if notes is empty, or combine them
        const adjustmentNotes = notes || remarks || '';

        const adj = await pool.query(`
            INSERT INTO stock_adjustments (product_id, adjustment_type, quantity, reason, notes, status, approved_by, approved_at, performed_by)
            VALUES ($1, $2, $3, $4, $5, 'Approved', $6, NOW(), $6)
            RETURNING adjustment_id
        `, [product_id, adjustment_type, Math.abs(delta), reason, adjustmentNotes, req.user.user_id]);

        // 4. Update product stock and new fields
        // Only update items_per_pack/remarks if provided/changed
        await pool.query(`
            UPDATE products SET 
                stock_quantity = $1, 
                items_per_pack = COALESCE($2, items_per_pack),
                remarks = COALESCE($3, remarks),
                updated_at = NOW()
            WHERE product_id = $4
        `, [finalQty, items_per_pack || null, remarks || null, product_id]);

        // 5. Check Low Stock
        if (finalQty <= product.reorder_level) {
            NotificationController.notifyRole(
                ['director', 'manager'],
                'low_stock',
                `Low Stock Alert: ${product.name} (${product.sku}) is at ${finalQty}`,
                product_id
            );
        }

        // 6. Record movement
        if (delta !== 0) {
            await pool.query(`
                INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, reason, balance_after, performed_by)
                VALUES ($1, 'ADJUSTMENT', $2, 'adjustment', $3, $4, $5, $6)
            `, [product_id, delta, adj.rows[0].adjustment_id, reason, finalQty, req.user.user_id]);
        }

        await pool.query('COMMIT');
        res.json({ message: 'Stock adjusted successfully.', new_balance: finalQty });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Adjust stock error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/inventory/stocktake — Commit full stocktake */
async function saveStocktake(req, res) {
    try {
        const { items, notes } = req.body;
        // items: [{ product_id, actual_quantity }]

        if (!items || items.length === 0) return res.status(400).json({ error: 'No items provided.' });

        await pool.query('BEGIN');

        let adjustmentCount = 0;

        for (const item of items) {
            const p = await pool.query('SELECT stock_quantity FROM products WHERE product_id = $1', [item.product_id]);
            if (p.rows.length === 0) continue;

            const currentQty = p.rows[0].stock_quantity;
            const actualQty = parseInt(item.actual_quantity);
            const delta = actualQty - currentQty;

            if (delta !== 0) {
                // Determine type
                const type = delta > 0 ? 'increase' : 'decrease';
                const absDelta = Math.abs(delta);

                // Create adjustment record
                const adj = await pool.query(`
                    INSERT INTO stock_adjustments (product_id, adjustment_type, quantity, reason, notes, status, approved_by, approved_at, performed_by)
                    VALUES ($1, $2, $3, 'Stocktake', $4, 'Approved', $5, NOW(), $5)
                    RETURNING adjustment_id
                `, [item.product_id, type, absDelta, notes, req.user.user_id]);

                // Update stock
                await pool.query('UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE product_id = $2', [actualQty, item.product_id]);

                // Movement
                await pool.query(`
                    INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, reason, balance_after, performed_by)
                    VALUES ($1, 'STOCKTAKE', $2, 'stocktake', $3, 'Stocktake Adjustment', $4, $5)
                `, [item.product_id, delta, adj.rows[0].adjustment_id, actualQty, req.user.user_id]);

                adjustmentCount++;
            }
        }

        await pool.query('COMMIT');
        res.json({ message: 'Stocktake committed successfully.', adjustments_made: adjustmentCount });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Stocktake error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Readable } = require('stream');

/** GET /api/inventory/stocktake/export — Download CSV template */
async function exportStocktake(req, res) {
    try {
        const result = await pool.query(`
            SELECT product_id, sku, name, stock_quantity 
            FROM products 
            WHERE is_active = true 
            ORDER BY name ASC
        `);

        const csvHeader = 'product_id,sku,name,current_stock,actual_count\n';
        const csvRows = result.rows.map(row => {
            // Escape quotes in name
            const safeName = `"${row.name.replace(/"/g, '""')}"`;
            return `${row.product_id},${row.sku || ''},${safeName},${row.stock_quantity},`;
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=stocktake_template.csv');
        res.status(200).send(csvContent);

    } catch (err) {
        console.error('Export stocktake error:', err);
        res.status(500).json({ error: 'Server error generating export.' });
    }
}

/** POST /api/inventory/stocktake/upload — Parse CSV and return data for review */
async function uploadStocktake(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        const results = [];
        const bufferStream = new Readable();
        bufferStream.push(req.file.buffer);
        bufferStream.push(null);

        bufferStream
            .pipe(csv())
            .on('data', (data) => {
                // console.log('Row:', data); 
                results.push(data);
            })
            .on('end', () => {
                const firstRow = results[0] || {};
                console.log('CSV Headers:', Object.keys(firstRow));
                console.log('First Row Sample:', firstRow);

                const parsedItems = results.map(row => {
                    // Handle potential BOM or case-sensitivity
                    const keys = Object.keys(row);
                    const prodKey = keys.find(k => k.trim().toLowerCase().replace(/^"|"$/g, '') === 'product_id');
                    const countKey = keys.find(k => k.trim().toLowerCase().replace(/^"|"$/g, '') === 'actual_count');

                    if (!prodKey || !countKey) return null;

                    const rawCount = row[countKey] ? row[countKey].trim() : '';
                    const hasCount = rawCount !== '' && !isNaN(parseInt(rawCount)) && parseInt(rawCount) >= 0;

                    return {
                        product_id: parseInt(row[prodKey]),
                        actual_quantity: hasCount ? parseInt(rawCount) : null
                    };
                }).filter(item =>
                    item && !isNaN(item.product_id)   // only require a valid product_id
                );

                console.log(`Parsed ${parsedItems.length} valid items from ${results.length} rows.`);
                res.json({ message: 'File parsed successfully', items: parsedItems });
            })
            .on('error', (err) => {
                console.error('CSV parse error:', err);
                res.status(500).json({ error: 'Error parsing CSV file.' });
            });

    } catch (err) {
        console.error('Upload stocktake error:', err);
        res.status(500).json({ error: 'Server error processing upload.' });
    }
}

/** POST /api/inventory/quick-receive/upload — Parse CSV for Stock Receiving */
async function uploadStockReceiving(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        const results = [];
        const bufferStream = new Readable();
        bufferStream.push(req.file.buffer);
        bufferStream.push(null);

        bufferStream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                if (results.length === 0) return res.json({ items: [] });

                // Map CSV and try to match existing products by barcode
                const items = [];
                for (const row of results) {
                    // Normalize keys
                    const r = {};
                    Object.keys(row).forEach(k => r[k.trim().toLowerCase()] = row[k]);

                    const barcode = r.barcode || r.upc || r.sku_barcode || '';
                    const name = r.name || r.product || r.description || '';
                    const qty = parseFloat(r.quantity || r.qty || r.amount || 0);
                    const cost = parseFloat(r.cost_price || r.cost || r.buying_price || 0);
                    const price = parseFloat(r.unit_price || r.price || r.selling_price || 0);
                    const category = r.category || 'General';
                    const unit = r.unit || r.uom || 'pcs';

                    if (!barcode && !name) continue;

                    let product = null;
                    if (barcode) {
                        const pRes = await pool.query('SELECT product_id, name, barcode, cost_price, unit_price FROM products WHERE barcode = $1 AND is_active = true', [barcode]);
                        if (pRes.rows.length > 0) product = pRes.rows[0];
                    }

                    items.push({
                        product_id: product ? product.product_id : null,
                        barcode: barcode || (product ? product.barcode : ''),
                        name: name || (product ? product.name : ''),
                        quantity_added: qty,
                        cost_price: cost || (product ? product.cost_price : 0),
                        unit_price: price || (product ? product.unit_price : 0),
                        category: category,
                        unit_of_measure: unit,
                        is_new: !product
                    });
                }

                res.json(items);
            })
            .on('error', (err) => {
                console.error('CSV parse error:', err);
                res.status(500).json({ error: 'Error parsing CSV file.' });
            });

    } catch (err) {
        console.error('Upload stock receiving error:', err);
        res.status(500).json({ error: 'Server error processing upload.' });
    }
}

/** POST /api/inventory/quick-receive — Smart bulk entry */
async function quickReceive(req, res) {
    const { supplier_id, items, notes, received_date } = req.body;
    if (!supplier_id || !items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Missing mandatory fields: supplier_id and items array.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Generate GRN
        const today = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
        const grnRes = await client.query("SELECT COUNT(*) AS count FROM goods_received WHERE grn_number LIKE $1", [`GRN-${today}-%`]);
        const grn_number = `GRN-${today}-${String(parseInt(grnRes.rows[0].count) + 1).padStart(3, '0')}`;

        const grn = await client.query(`
            INSERT INTO goods_received (grn_number, supplier_id, received_by, notes, received_date)
            VALUES ($1, $2, $3, $4, $5) RETURNING grn_id
        `, [grn_number, supplier_id, req.user.user_id, notes || 'Quick Inbound Receipt', received_date || new Date().toISOString().split('T')[0]]);
        const grnId = grn.rows[0].grn_id;

        for (const item of items) {
            let productId = item.product_id;

            // 2. Create product if it doesn't exist
            if (!productId) {
                // Generate internal barcode if missing
                let barcode = item.barcode;
                if (!barcode) {
                    const countRes = await client.query("SELECT COUNT(*) FROM products");
                    barcode = `INT-${String(parseInt(countRes.rows[0].count) + 1001).padStart(4, '0')}`;
                }

                const newProd = await client.query(`
                    INSERT INTO products (name, barcode, category, cost_price, unit_price, unit_of_measure, stock_quantity, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
                    RETURNING product_id
                `, [item.name, barcode, item.category || 'General', item.cost_price || 0, item.unit_price || 0, item.unit_of_measure || 'pcs', req.user.user_id]);
                productId = newProd.rows[0].product_id;
            } else {
                // Update cost price for existing products
                if (item.cost_price) {
                    await client.query('UPDATE products SET cost_price = $1, updated_at = NOW() WHERE product_id = $2', [item.cost_price, productId]);
                }
            }

            // 3. Add stock
            const qty = parseInt(item.quantity_added) || 0;
            if (qty > 0) {
                await client.query('UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE product_id = $2', [qty, productId]);

                // 4. Record GRN item
                await client.query(`
                    INSERT INTO grn_items (grn_id, product_id, quantity_received, unit_cost)
                    VALUES ($1, $2, $3, $4)
                `, [grnId, productId, qty, item.cost_price || 0]);

                // 5. Record movement
                const balanceRes = await client.query('SELECT stock_quantity FROM products WHERE product_id = $1', [productId]);
                await client.query(`
                    INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, balance_after, performed_by, reason)
                    VALUES ($1, 'GRN', $2, 'grn', $3, $4, $5, $6)
                `, [productId, qty, grnId, balanceRes.rows[0].stock_quantity, req.user.user_id, 'Quick Receive']);
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Stock received successfully', grn_number });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Quick receive error:', err);
        res.status(500).json({ error: 'Server error during stock receipt.' });
    } finally {
        client.release();
    }
}

module.exports = { getInventory, getMovements, adjustStock, saveStocktake, exportStocktake, uploadStocktake, quickReceive, uploadStockReceiving };
