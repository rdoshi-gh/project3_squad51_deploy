const { Pool } = require('pg');
require('../../lib/db');

// Every table is connection-local and shadows the team's real tables. The outer
// transaction is always rolled back, including when a test or preview fails.
async function openFixture() {
    const pool = new Pool({ user: process.env.PSQL_USER, host: process.env.PSQL_HOST,
        database: process.env.PSQL_DATABASE, password: process.env.PSQL_PASSWORD,
        port: Number(process.env.PSQL_PORT || 5432), connectionTimeoutMillis: 10000,
        ssl: process.env.PSQL_SSL === 'false' ? false : { rejectUnauthorized: false } });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            CREATE TEMP TABLE employees (employee_id INT PRIMARY KEY, name VARCHAR(150), role VARCHAR(50)) ON COMMIT DROP;
            CREATE TEMP TABLE menu_items (menu_item_id INT PRIMARY KEY, name VARCHAR(150), category VARCHAR(150), price NUMERIC(6,2)) ON COMMIT DROP;
            CREATE TEMP TABLE inventory_items (inventory_item_id INT PRIMARY KEY, name VARCHAR(150), quantity NUMERIC(10,2), unit VARCHAR(50), reorder_level NUMERIC(10,2)) ON COMMIT DROP;
            CREATE TEMP TABLE customer_orders (order_id INT PRIMARY KEY, employee_id INT REFERENCES employees, order_timestamp TIMESTAMP, total_price NUMERIC(8,2)) ON COMMIT DROP;
            CREATE TEMP TABLE order_items (order_item_id INT PRIMARY KEY, order_id INT REFERENCES customer_orders, menu_item_id INT REFERENCES menu_items, quantity INT) ON COMMIT DROP;
            CREATE TEMP TABLE recipes (recipe_id INT PRIMARY KEY, menu_item_id INT REFERENCES menu_items, inventory_item_id INT REFERENCES inventory_items, quantity_required NUMERIC(10,4)) ON COMMIT DROP;
            CREATE TEMP TABLE reorder_requests (reorder_request_id INT PRIMARY KEY, inventory_item_id INT REFERENCES inventory_items, quantity_requested NUMERIC(10,2), request_date_time TIMESTAMP) ON COMMIT DROP;
            INSERT INTO employees VALUES (1,'Test Manager','Manager'),(2,'Test Cashier','Cashier');
            INSERT INTO menu_items VALUES (1,'Milk Tea','Milk Tea',5.25),(2,'Boba','Topping',0.50),(3,'Green Tea','Tea',4.00);
            INSERT INTO inventory_items VALUES (1,'Milk',20,'gallons',10),(2,'Boba Pearls',9,'bags',10),(3,'Green Tea Leaves',30,'oz',10);
            INSERT INTO recipes VALUES (1,1,1,1),(2,2,2,0.5),(3,3,3,0.25);
            INSERT INTO customer_orders VALUES (1,2,'2026-10-01 23:59:59',11.50),(2,2,'2026-10-02 08:00:00',4.00);
            INSERT INTO order_items VALUES (1,1,1,2),(2,1,2,2),(3,2,3,1);
            INSERT INTO reorder_requests VALUES (1,2,4,'2026-10-02 10:00:00');
        `);
        const db = {
            query: async (sql, values = []) => (await client.query(sql, values)).rows,
            async nextId(connection, table, column) {
                const allowed = { employees: 'employee_id', menu_items: 'menu_item_id', inventory_items: 'inventory_item_id', customer_orders: 'order_id', order_items: 'order_item_id', recipes: 'recipe_id', reorder_requests: 'reorder_request_id' };
                if (allowed[table] !== column) throw new Error('Unknown fixture ID source.');
                // These tables belong only to this connection. Do not acquire the
                // production advisory lock for the lifetime of this preview.
                return Number((await connection.query(`SELECT COALESCE(MAX(${column}),0) + 1 AS id FROM ${table}`)).rows[0].id);
            },
            async transaction(work) {
                await client.query('SAVEPOINT app_write');
                try { const value = await work(client); await client.query('RELEASE SAVEPOINT app_write'); return value; }
                catch (error) { await client.query('ROLLBACK TO SAVEPOINT app_write'); await client.query('RELEASE SAVEPOINT app_write'); throw error; }
            }
        };
        return { db, close: async () => { await client.query('ROLLBACK'); client.release(); await pool.end(); } };
    } catch (error) { await client.query('ROLLBACK'); client.release(); await pool.end(); throw error; }
}

module.exports = { openFixture };
