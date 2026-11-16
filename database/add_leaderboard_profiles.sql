-- Run after add_lifetime_points.sql. Names are chosen by signed-in customers;
-- Google email addresses and profile names are not published by default.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(40) CHECK (LENGTH(TRIM(display_name)) > 0);
CREATE INDEX IF NOT EXISTS customers_lifetime_points_idx ON customers (lifetime_points DESC, customer_id);
