const express = require('express');
const { createApp } = require('./application');
const { db } = require('./lib/db');
const app = express();
createApp({ app });
const port = Number(process.env.PORT || 3000);

// Start the HTTP server on Render and locally; imports can still use the app in tests.
if (require.main === module) {
    const server = app.listen(port, '0.0.0.0', () => console.log(`Popping POS listening on port ${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
    }
}
module.exports = app;
