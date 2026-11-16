-- Run after add_customers.sql, before deploying Lifetime Points tracking.
-- Existing redeemable balances are preserved. Tracking starts at zero on
-- launch because earlier earned/redeemed totals were not recorded.
-- Safe to re-run without resetting any previously tracked Lifetime Points.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS lifetime_points INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0);
