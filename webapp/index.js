
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

// Create express app
const app = express();
const port = 3000;

// Create pool
const pool = new Pool({
    user: process.env.PSQL_USER,
    host: process.env.PSQL_HOST,
    database: process.env.PSQL_DATABASE,
    password: process.env.PSQL_PASSWORD,
    port: process.env.PSQL_PORT,
    ssl: { rejectUnauthorized: false }
});

// Add process hook to shutdown pool
process.on('SIGINT', function() {
    pool.end();
    console.log('Application successfully shutdown');
    process.exit(0);
});

const path = require('path');

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.get('/', (req, res) => {
    const data = { name: 'Mario' };
    res.render('index', data);
});

app.get('/user', (req, res) => {app.set("views", path.join(__dirname, "views"));
    pool.query('SELECT * FROM teammates;')
        .then(query_res => {
            const teammembers = query_res.rows;
            const data = { teammembers: teammembers };
            console.log(teammembers);
            res.render('user', data);
        })
        .catch(err => {
            console.error('Database query failed:', err);
            res.status(503).send('Unable to load team members from the database.');
        });
});

// Run locally, but let Vercel handle requests in production
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Example app listening at http://localhost:${port}`);
    });
}

module.exports = app;
