// Optional local preview. All sample records live in connection-local temporary
// tables and are rolled back on exit. This script is never loaded by index.js.
const express = require('express');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createApp } = require('../application');
const { openFixture } = require('./helpers/fixture');
const { sessions } = require('../lib/session');

(async () => {
    const fixture = await openFixture();
    try {
        await fixture.db.query(`CREATE TEMP TABLE customers (customer_id INT PRIMARY KEY, email TEXT, points INT NOT NULL DEFAULT 0);
            INSERT INTO customers SELECT i, 'preview-' || i || '@example.invalid', 25 FROM generate_series(1,13) i;`);
        for (const file of ['add_lifetime_points.sql', 'add_leaderboard_profiles.sql']) {
            await fixture.db.query(readFileSync(path.join(__dirname, '../../database', file), 'utf8'));
        }
        await fixture.db.query(`UPDATE customers SET lifetime_points = (13 - customer_id) * 20,
            display_name = 'Boba fan ' || customer_id;
            UPDATE customers SET lifetime_points = 240 WHERE customer_id = 2;
            UPDATE customers SET display_name = 'Tea Time' WHERE customer_id = 1;`);
        const secret = 'local-leaderboard-preview-secret';
        const app = express();
        // Preview-only shortcut exercises the existing customer session without
        // needing real Google credentials. It cannot be reached in production.
        app.get('/preview/customer', (req, res) => {
            sessions(secret).writeSigned(res, 'popping_customer', { customerId: 12, firstName: 'Preview' }, 15 * 60 * 1000);
            res.redirect('/leaderboard');
        });
        const port = Number(process.env.PREVIEW_PORT || 3002);
        const server = createApp({ app, db: fixture.db, secret }).listen(port, '127.0.0.1', () => {
            console.log(`Isolated leaderboard preview: http://localhost:${port}/leaderboard`);
        });
        for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => {
            await fixture.close(); process.exit(0);
        }));
    } catch (error) { await fixture.close(); throw error; }
})().catch(error => { console.error(error.message); process.exit(1); });
