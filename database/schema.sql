-- Project 2 schema reference. No data deletion or seeding.
-- Retained for Project 3 database planning; the existing database already has these tables.

BEGIN;

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
    employee_id      INTEGER       NOT NULL REFERENCES employees(employee_id)
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

COMMIT;
