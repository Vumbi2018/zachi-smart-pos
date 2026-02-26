const pool = require('../db/pool');

/**
 * GET /api/customers
 */
async function listCustomers(req, res) {
    try {
        const { search, type, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        const conditions = [];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(full_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR company_name ILIKE $${params.length})`);
        }

        if (type) {
            params.push(type);
            conditions.push(`customer_type = $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        params.push(limit);
        params.push(offset);
        const result = await pool.query(
            `SELECT * FROM customers ${where} ORDER BY full_name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({ customers: result.rows });
    } catch (err) {
        console.error('List customers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/customers/:id
 */
async function getCustomer(req, res) {
    try {
        const result = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/customers
 */
async function createCustomer(req, res) {
    try {
        const { full_name, phone, email, company_name, t_pin, customer_type, notes } = req.body;
        if (!full_name) return res.status(400).json({ error: 'Full name is required.' });

        const result = await pool.query(
            `INSERT INTO customers (full_name, phone, email, company_name, t_pin, customer_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [full_name, phone || null, email || null, company_name || null, t_pin || null, customer_type || 'walk-in', notes || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * PUT /api/customers/:id
 */
async function updateCustomer(req, res) {
    try {
        const { full_name, phone, email, company_name, t_pin, customer_type, notes } = req.body;
        const result = await pool.query(
            `UPDATE customers SET
        full_name = COALESCE($1, full_name), phone = COALESCE($2, phone),
        email = COALESCE($3, email), company_name = COALESCE($4, company_name),
        t_pin = COALESCE($5, t_pin), customer_type = COALESCE($6, customer_type),
        notes = COALESCE($7, notes), updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $8 RETURNING *`,
            [full_name, phone, email, company_name, t_pin, customer_type, notes, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}


const csv = require('csv-parser');
const stream = require('stream');

// ... existing code ...

/**
 * POST /api/customers/import
 */
async function importCustomers(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: 'Please upload a CSV file.' });
    }

    const results = [];
    const errors = [];
    let importedCount = 0;
    let updatedCount = 0;

    const processRow = async (row) => {
        // Map CSV headers to DB fields
        // Expected headers: Full Name, Phone, Email, Company, TPIN, Type, Notes
        const fullName = row['Full Name'] || row['full_name'];
        const phone = row['Phone'] || row['phone'];
        const email = row['Email'] || row['email'];
        const company = row['Company'] || row['company_name'];
        const tpin = row['TPIN'] || row['t_pin'];
        const type = row['Type'] || row['customer_type'] || 'walk-in';
        const notes = row['Notes'] || row['notes'];

        if (!fullName) {
            errors.push({ row, error: 'Full Name is required.' });
            return;
        }

        try {
            // Check existence by Phone or Email if provided
            let existing = null;
            if (phone) {
                const r = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
                existing = r.rows[0];
            }
            if (!existing && email) {
                const r = await pool.query('SELECT * FROM customers WHERE email = $1', [email]);
                existing = r.rows[0];
            }

            if (existing) {
                // Update
                await pool.query(
                    `UPDATE customers SET 
                     full_name = COALESCE($1, full_name),
                     company_name = COALESCE($2, company_name),
                     t_pin = COALESCE($3, t_pin),
                     customer_type = COALESCE($4, customer_type),
                     notes = COALESCE($5, notes),
                     updated_at = CURRENT_TIMESTAMP
                     WHERE customer_id = $6`,
                    [fullName, company, tpin, type, notes, existing.customer_id]
                );
                updatedCount++;
            } else {
                // Insert
                await pool.query(
                    `INSERT INTO customers (full_name, phone, email, company_name, t_pin, customer_type, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [fullName, phone || null, email || null, company || null, tpin || null, type, notes || null]
                );
                importedCount++;
            }
        } catch (err) {
            errors.push({ row, error: err.message });
        }
    };

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    bufferStream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
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
 * GET /api/customers/export
 */
async function exportCustomers(req, res) {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY full_name');
        const customers = result.rows;

        const headers = ['Full Name', 'Phone', 'Email', 'Company', 'TPIN', 'Type', 'Notes'];
        const csvRows = [headers.join(',')];

        customers.forEach(c => {
            const row = [
                c.full_name,
                c.phone || '',
                c.email || '',
                c.company_name || '',
                c.t_pin || '',
                c.customer_type || 'walk-in',
                c.notes || ''
            ].map(val => {
                let v = String(val || '');
                if (v.includes(',') || v.includes('"') || v.includes('\n')) {
                    v = `"${v.replace(/"/g, '""')}"`;
                }
                return v;
            });
            csvRows.push(row.join(','));
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
        res.send(csvRows.join('\n'));
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/customers/import-template
 */
async function getImportTemplate(req, res) {
    const headers = ['Full Name', 'Phone', 'Email', 'Company', 'TPIN', 'Type', 'Notes'];
    const example = ['John Doe', '0977123456', 'john@example.com', 'Doe Enterprises', '1234567890', 'regular', 'Example Note'];
    const csvContent = [headers.join(','), example.join(',')].join('\n');

    res.attachment('customer_import_template.csv');
    res.set('Content-Type', 'text/csv');
    res.send(Buffer.from(csvContent));
}

module.exports = { listCustomers, getCustomer, createCustomer, updateCustomer, importCustomers, exportCustomers, getImportTemplate };
