// Optional browser sandbox: all edits affect only PostgreSQL temporary tables.
require('dotenv').config();
const { createApp } = require('../application');
const { openFixture } = require('./helpers/fixture');
(async () => {
    const fixture = await openFixture();
    const port = Number(process.env.PREVIEW_PORT || 3001);
    const server = createApp({ db: fixture.db, secret: 'local-isolated-preview-secret' }).listen(port, '127.0.0.1', () => console.log(`Isolated test-data preview: http://localhost:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await fixture.close(); process.exit(0); }));
})().catch(error => { console.error(error.message); process.exit(1); });
