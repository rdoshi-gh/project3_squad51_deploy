-- Kitchen Display migration. Run ONCE on the team's PostgreSQL database.
-- Historical orders start as 'ready', so they don't flood the new queue.
-- All orders created after the migration default to 'in_progress', from BOTH
-- the cashier and customer kiosk, without changing the checkout transaction.
BEGIN;

ALTER TABLE customer_orders
  ADD COLUMN IF NOT EXISTS kitchen_status TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE customer_orders
  ALTER COLUMN kitchen_status SET DEFAULT 'in_progress';

ALTER TABLE customer_orders
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'customer_orders'::regclass
      AND conname = 'customer_orders_kitchen_status_check'
  ) THEN
    ALTER TABLE customer_orders
      ADD CONSTRAINT customer_orders_kitchen_status_check
      CHECK (kitchen_status IN ('in_progress', 'ready'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_orders_kitchen_queue
  ON customer_orders (kitchen_status, order_timestamp, order_id);

COMMIT;
