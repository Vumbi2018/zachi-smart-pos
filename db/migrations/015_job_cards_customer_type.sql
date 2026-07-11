-- =====================================================
-- Migration 015: Add customer_type to job_cards
-- =====================================================
-- The createJob controller (apps/zachi-pos/controllers/jobCardController.js)
-- inserts into a `customer_type` column that was never declared in any
-- earlier migration, causing POST /api/jobs to 500 with Postgres error
-- 42703 ("column \"customer_type\" of relation \"job_cards\" does not exist")
-- on every fresh install (including production).
--
-- Default 'Walk-in' matches the controller fallback so any rows that
-- somehow get inserted without the field still satisfy the column.
-- =====================================================

ALTER TABLE job_cards
    ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) DEFAULT 'Walk-in';
