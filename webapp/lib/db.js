const { Pool, types } = require('pg');
require('dotenv').config();

// Preserve PostgreSQL wall-clock timestamps across local and serverless timezones.
// Project 2 stores TIMESTAMP WITHOUT TIME ZONE rather than an absolute instant.
types.setTypeParser(1114, value => value.replace(' ', 'T'));

function createDb(pool) {
    return {
        async query(sql, params = []) {
            return (await pool.query({ text: sql, values: params, query_timeout: 30000 })).rows;
        },
        async transaction(work) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await work(client);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },
        async nextId(client, table, column) {
            const allowed = {
                employees: 'employee_id', menu_items: 'menu_item_id', inventory_items: 'inventory_item_id',
                customer_orders: 'order_id', order_items: 'order_item_id', recipes: 'recipe_id', reorder_requests: 'reorder_request_id'
            };
            if (allowed[table] !== column) throw new Error('Unknown ID source.');
            // Project 2 uses integer IDs without sequences. Serialize allocation across web requests.
            await client.query('SELECT pg_advisory_xact_lock(51, 331)');
            const result = await client.query(`SELECT COALESCE(MAX(${column}), 0) + 1 AS id FROM ${table}`);
            return Number(result.rows[0].id);
        },
        close: () => pool.end()
    };
}

const pool = new Pool({
    user: process.env.PSQL_USER,
    host: process.env.PSQL_HOST,
    database: process.env.PSQL_DATABASE,
    password: process.env.PSQL_PASSWORD,
    port: Number(process.env.PSQL_PORT || 5432),
    // Preserve the repository's TAMU/Vercel TLS configuration; local PostgreSQL can opt out.
    ssl: process.env.PSQL_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    statement_timeout: 30000
});
pool.on('error', error => console.error('Idle database connection failed:', error.message));

module.exports = { createDb, db: createDb(pool) };
