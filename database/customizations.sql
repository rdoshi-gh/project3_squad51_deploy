-- Customization fields for order items.
-- Run against the existing Project 2 database. This migration is safe to rerun.
BEGIN;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT 'Regular';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sweetness INTEGER NOT NULL DEFAULT 100;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS ice TEXT NOT NULL DEFAULT 'Regular';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS topping_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(8,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE order_items ADD CONSTRAINT order_items_size_check CHECK (size IN ('Small', 'Regular', 'Large'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE order_items ADD CONSTRAINT order_items_sweetness_check CHECK (sweetness BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE order_items ADD CONSTRAINT order_items_ice_check CHECK (ice IN ('No', 'Light', 'Regular', 'Extra'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
