-- Migration: 011_sale_items_cost_price.sql
-- Description: Adds cost_price to sale_items table to capture historical cost exactly at the time of sale.
-- It also populates existing sale_items with current product costs so past reports do not break.

-- 1. Add cost_price column
ALTER TABLE sale_items
ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10, 2) DEFAULT 0;

-- 2. Populate existing historical data using current product costs.
-- For product line items, copy cost_price from products.
UPDATE sale_items si
SET cost_price = p.cost_price
FROM products p
WHERE si.product_id = p.product_id
  AND si.item_type = 'product';

-- For service and custom items, we'll leave it as 0
-- (Unless service has a base cost, but standard services usually have ~100% gross margin computationally unless materials are tracked).

-- 3. (Optional but recommended) Change default from 0 to NULL if preferred, but 0 is usually fine for math.
-- Leaving as 0.
