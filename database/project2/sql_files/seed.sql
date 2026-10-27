-- ============================================================================
-- Phase 2 database seeding -- creates tables AND loads data (PostgreSQL)
-- ============================================================================
-- Self-contained: run this file from inside psql with all CSV files in the
-- same folder.
--
-- USAGE:
--     \cd /path/to/project2-squad-51
--     \i seed.sql
--
-- This script:
--   1. creates all seven tables if they do not already exist
--   2. clears existing rows so the seed is re-runnable
--   3. bulk-loads each CSV with \copy
--   4. prints a sanity check of the populated database
--
-- Bulk loading is used instead of thousands of INSERT statements so the
-- database can be seeded quickly during the live demo.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- Tables
-- Create parent tables before tables that reference them.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
    employee_id  INTEGER  PRIMARY KEY,
    name         TEXT     NOT NULL,
    role         TEXT     NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
    menu_item_id  INTEGER       PRIMARY KEY,
    name          TEXT          NOT NULL,
    category      TEXT          NOT NULL,
    price         NUMERIC(6,2)  NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
    inventory_item_id  INTEGER        PRIMARY KEY,
    name               TEXT           NOT NULL,
    quantity           NUMERIC(10,2)  NOT NULL,
    unit               TEXT           NOT NULL,
    reorder_level      NUMERIC(10,2)  NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_orders (
    order_id         INTEGER       PRIMARY KEY,
    employee_id      INTEGER       NOT NULL REFERENCES employees(employee_id),
    order_timestamp  TIMESTAMP     NOT NULL,
    total_price      NUMERIC(8,2)  NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id  INTEGER  PRIMARY KEY,
    order_id       INTEGER  NOT NULL REFERENCES customer_orders(order_id),
    menu_item_id   INTEGER  NOT NULL REFERENCES menu_items(menu_item_id),
    quantity       INTEGER  NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
    recipe_id          INTEGER        PRIMARY KEY,
    menu_item_id       INTEGER        NOT NULL REFERENCES menu_items(menu_item_id),
    inventory_item_id  INTEGER        NOT NULL REFERENCES inventory_items(inventory_item_id),
    quantity_required  NUMERIC(10,4)  NOT NULL
);

CREATE TABLE IF NOT EXISTS reorder_requests (
    reorder_request_id  INTEGER        PRIMARY KEY,
    inventory_item_id   INTEGER        NOT NULL REFERENCES inventory_items(inventory_item_id),
    quantity_requested  NUMERIC(10,2)  NOT NULL,
    request_date_time   TIMESTAMP      NOT NULL
);

-- ----------------------------------------------------------------------------
-- Fresh load: clear existing rows so re-seeding is repeatable.
-- Child tables are listed first for readability; CASCADE handles dependencies.
-- ----------------------------------------------------------------------------

TRUNCATE
    reorder_requests,
    recipes,
    order_items,
    customer_orders,
    inventory_items,
    menu_items,
    employees
RESTART IDENTITY CASCADE;

-- ----------------------------------------------------------------------------
-- Bulk load.
-- Load order matters because of foreign keys.
-- Each \copy command must stay on one physical line.
-- ----------------------------------------------------------------------------

\copy employees (employee_id, name, role) FROM 'employees.csv' WITH (FORMAT csv, HEADER true)
\copy menu_items (menu_item_id, name, category, price) FROM 'menu_items.csv' WITH (FORMAT csv, HEADER true)
\copy inventory_items (inventory_item_id, name, quantity, unit, reorder_level) FROM 'inventory_items.csv' WITH (FORMAT csv, HEADER true)
\copy customer_orders (order_id, employee_id, order_timestamp, total_price) FROM 'customer_orders.csv' WITH (FORMAT csv, HEADER true)
\copy order_items (order_item_id, order_id, menu_item_id, quantity) FROM 'order_items.csv' WITH (FORMAT csv, HEADER true)
\copy recipes (recipe_id, menu_item_id, inventory_item_id, quantity_required) FROM 'recipes.csv' WITH (FORMAT csv, HEADER true)
\copy reorder_requests (reorder_request_id, inventory_item_id, quantity_requested, request_date_time) FROM 'reorder_requests.csv' WITH (FORMAT csv, HEADER true)

-- ----------------------------------------------------------------------------
-- Keep SERIAL/IDENTITY sequences in sync if the final schema later uses them.
-- This is a no-op for the current plain INTEGER primary keys.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    seq text;
BEGIN
    seq := pg_get_serial_sequence('employees', 'employee_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(employee_id) FROM employees)); END IF;

    seq := pg_get_serial_sequence('menu_items', 'menu_item_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(menu_item_id) FROM menu_items)); END IF;

    seq := pg_get_serial_sequence('inventory_items', 'inventory_item_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(inventory_item_id) FROM inventory_items)); END IF;

    seq := pg_get_serial_sequence('customer_orders', 'order_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(order_id) FROM customer_orders)); END IF;

    seq := pg_get_serial_sequence('order_items', 'order_item_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(order_item_id) FROM order_items)); END IF;

    seq := pg_get_serial_sequence('recipes', 'recipe_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(recipe_id) FROM recipes)); END IF;

    seq := pg_get_serial_sequence('reorder_requests', 'reorder_request_id');
    IF seq IS NOT NULL THEN PERFORM setval(seq, (SELECT MAX(reorder_request_id) FROM reorder_requests)); END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- Sanity check.
-- Expected from the current generated CSVs:
--   employees:          5
--   menu_items:        24
--   inventory_items:   33
--   customer_orders: 93417
--   order_items:    212002
--   recipes:           141
--   reorder_requests:  333
--   total_sales: $1,043,865.00
--   history: 52 weeks
-- ----------------------------------------------------------------------------

SELECT
    (SELECT COUNT(*) FROM employees)                         AS employees,
    (SELECT COUNT(*) FROM menu_items)                        AS menu_items,
    (SELECT COUNT(*) FROM inventory_items)                   AS inventory_items,
    (SELECT COUNT(*) FROM customer_orders)                   AS customer_orders,
    (SELECT COUNT(*) FROM order_items)                       AS order_items,
    (SELECT COUNT(*) FROM recipes)                           AS recipes,
    (SELECT COUNT(*) FROM reorder_requests)                  AS reorder_requests,
    (SELECT ROUND(SUM(total_price), 2) FROM customer_orders) AS total_sales,
    (SELECT MIN(order_timestamp)::date FROM customer_orders) AS first_sale_date,
    (SELECT MAX(order_timestamp)::date FROM customer_orders) AS last_sale_date,
    (
        SELECT (MAX(order_timestamp)::date - MIN(order_timestamp)::date) + 1
        FROM customer_orders
    )                                                       AS days_of_history,
    (
        SELECT ROUND(
            ((MAX(order_timestamp)::date - MIN(order_timestamp)::date) + 1) / 7.0,
            2
        )
        FROM customer_orders
    )                                                       AS weeks_of_history;
