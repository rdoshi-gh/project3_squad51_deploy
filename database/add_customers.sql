-- Customer accounts for kiosk Google sign-in and loyalty points.
-- Run once against the team database (safe to re-run).
CREATE TABLE IF NOT EXISTS customers (
    customer_id  SERIAL       PRIMARY KEY,
    email        TEXT         NOT NULL,
    points       INTEGER      NOT NULL DEFAULT 0 CHECK (points >= 0),
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_key ON customers (LOWER(email));
