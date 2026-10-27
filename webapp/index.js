const express = require('express');
const { createApp } = require('./application');
const { db } = require('./lib/db');
const app = express();
createApp({ app });
const port = Number(process.env.PORT || 3000);

// Vercel imports this app; the listener is only needed for local development.
if (require.main === module) {
    const server = app.listen(port, () => console.log(`Popping POS listening at http://localhost:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
    }
}
module.exports = app;
