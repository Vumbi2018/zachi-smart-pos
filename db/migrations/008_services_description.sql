-- Migration 008: Add description column to services table
-- This column was missing from the initial schema, causing 500 errors on service updates.

ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;
