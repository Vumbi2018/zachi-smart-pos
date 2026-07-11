require('dotenv').config();
const pool = require('./db/pool');
(async () => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(p.name, 'Unknown') AS name,
             COALESCE(SUM(si.line_total), 0)::float AS revenue,
             COALESCE(SUM(si.quantity), 0)::float AS qty
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.sale_id
      LEFT JOIN products p ON si.product_id = p.product_id
      WHERE s.transaction_date >= NOW() - INTERVAL '30 days'
        AND s.is_voided = FALSE
        AND si.item_type = 'product'
      GROUP BY p.name
      ORDER BY revenue DESC
      LIMIT 5
    `);
    console.log('TOP PRODUCTS (last 30d):', JSON.stringify(r.rows, null, 2));
    process.exit(0);
  } catch (e) { console.error('FAIL', e.message); process.exit(1); }
})();
