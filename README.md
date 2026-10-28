# Popping POS (Team 51)

Project 2's Java Swing workflows ported to the repository's Express/EJS web app,
using the existing PostgreSQL database. No schema migration or reseeding is required.

## Team development map

- `webapp/index.js`: local server and Vercel entry point.
- `webapp/application.js`: Express page routes, APIs, and role checks.
- `webapp/lib/`: database connection, sessions, validation, checkout, and reports.
- `webapp/views/`: EJS page structure and shared head.
- `webapp/public/static/`: shared CSS and cashier/manager browser code.
- `webapp/test/`: offline tests and isolated PostgreSQL tests/preview.
- `database/schema.sql`: the seven-table Project 2 schema, without data resets.
- `database/project2/`: original seed generator and SQL files for reference.

The seed loader in `database/project2/sql_files/seed.sql` truncates existing data.
It is retained as reference and is never run by the app. The existing team
database is already populated; do not reseed it as part of normal setup.
Generated CSV files are not needed to run the web app.

Each teammate should create their own ignored `webapp/.env` from `.env.example`
and get the database credentials privately. For new Project 3 work, add the page
and API routes in `application.js`, keep SQL in `lib/`, and use the existing
shared CSS and DOM helpers. Future database changes should be tracked as explicit
migrations, separate from the original seed loader.

## Local development

```sh
cd webapp
npm ci
cp .env.example .env
# Fill in your existing Project 2 database settings and a random SESSION_SECRET.
npm start
```

Open http://localhost:3000. A local `.env` that is already configured should be
kept rather than replaced. Never commit passwords or the real session secret.
`PORT` can override the default 3000. Use a currently supported Node.js runtime
with the built-in `node:test` runner (tested locally with Node 22).

The portal opens the cashier or manager employee-selection screen. Log Out
returns to that workspace's sign-in screen. The employee workspaces do not link
to each other or to the portal.

## Included workflows

- Cashier: category/search menu, quantities, sweetness, ice, toppings, line edits,
  removal, reset, undo/redo, review, order completion, and employee profile.
- Checkout: server-side menu prices, topping quantities, recipe-based stock
  deductions, stock availability checks, and atomic order/inventory writes.
- Manager: dashboard, date-filtered order history and details, ordering trends,
  inventory CRUD, physical counts, and reorder-level review.
- Restocking: create supply reorder requests and view their history. Requests
  do not increase stock; physical counts update inventory after receipt.
- Employees: add, edit, and delete records when order history allows it.
- Menu: add, edit, and delete items, change prices/categories, and manage recipes.
- Reports: Daily Sales Summary, Top Selling Items, Inventory Status, X Report
  (hourly sales), Sales Report, Restock Report, and Product Usage charts.
  Product Usage includes Last 7 Days, Last 30 Days, and All Time shortcuts.
  Reports reload when settings change; Refresh Report reloads the same settings.

The original `/user` teammates example remains available for deployment parity;
it requires the original `teammates` table and is not part of the POS workflow.

## Database behavior and limits inherited from Project 2

The app uses `employees`, `customer_orders`, `order_items`, `menu_items`,
`inventory_items`, `recipes`, and `reorder_requests` with the existing columns.
ID allocation uses a transaction-scoped PostgreSQL advisory lock because the
original integer IDs have no sequences. Other programs writing to these same
tables should follow the same allocation convention to avoid ID collisions.

Historical order totals are stored in `customer_orders.total_price`. The original
schema does not store historical unit prices, sweetness, or ice choices. The
cashier supports customizations during order entry, and toppings are stored as
menu-item quantities, matching Project 2. Order details and Sales Report clearly
identify current-price estimates. Historical product usage uses current recipes.
Database timestamps have no timezone; the UI preserves their wall-clock values.

The reorder suggestion matches Project 2: four weeks of recipe-based order usage
ending on the latest order date, divided by four and rounded up. Recent requests
are shown alongside it for manager review; they are not inputs to that formula.
Managers can change the suggested value before applying a custom level.

Restock Report lists items strictly below the reorder level. Inventory Status
also flags items exactly at their threshold. Snapshot reports and X Report do
not use the historical date controls. X Report uses the database's current day
and clock; the current hour is incomplete.

Order History shows at most 500 orders; narrow the date range to see older ones.
Its totals cover the entire selected period. Reorder history shows the latest
100 requests. A failed network response during checkout can be ambiguous: check
order history before retrying, since the existing schema has no retry token.

## Authentication scope

This pass preserves Project 2's employee-selection sign-in. It issues a signed,
HTTP-only, one-hour cookie, enforces cashier/manager routes, and rejects
cross-origin browser writes. **Selecting an employee does not verify identity.**
This is a prototype sign-in flow, not the external authentication required for
Project 3. Integrate the team's chosen identity provider and employee mapping
before exposing employee operations to untrusted users. A production deployment
requires `SESSION_SECRET`; without it, employee sign-in is unavailable.

## Tests and safe browser preview

```sh
cd webapp
npm test
RUN_DB_TESTS=1 npm test
node test/preview.js
```

`npm test` runs offline validation, pricing, reports, transaction-call, route,
asset-syntax, and deployment-entry tests. PostgreSQL integration tests are
opt-in and use `.env`: they first run read-only reports on the team database,
then exercise CRUD, authorization, inventory, reorder requests, and checkout in
connection-local temporary tables. The outer transaction is rolled back. Real
team records are not changed.

The optional preview opens http://localhost:3001 using those same isolated
sample tables (Test Manager #1 / Test Cashier #2). All preview edits disappear
when the process stops. Restart it to reset sample data. This preview requires
a PostgreSQL connection with temporary-table permissions and is never the
production server. `PREVIEW_PORT` can override 3001.

## Vercel deployment

Keep **Root Directory** set to `webapp`, as in the original repository. The
entry point is `index.js`, exporting Express; no build command or output-directory
override is needed. `vercel.json` includes the EJS templates in the function.
Static assets live in `public/static/` and use `/static/...` URLs both locally
and on Vercel. This follows Vercel's [Express deployment guidance](https://vercel.com/docs/frameworks/backend/express).

Set these environment variables in the Vercel project for Production and Preview:

- `PSQL_HOST`
- `PSQL_USER`
- `PSQL_DATABASE`
- `PSQL_PASSWORD`
- `PSQL_PORT`
- `SESSION_SECRET` (a long, random value; keep it stable across instances)

The database must accept connections from the deployment. The repository's
existing PostgreSQL TLS configuration is preserved. `.env` and `.vercel/` stay
out of Git. Review the authentication scope above before publishing. Import
through Vercel's Git integration, or run `vercel --prod` from `webapp/` only
when the team is ready to publish.

## Customer Kiosk

The public Customer Kiosk is available at `/kiosk` and is linked from the Portal Hub. It reads menu items from `/api/kiosk/menu`, supports drink search and category filters, sweetness/ice/topping customizations, cart editing, and public order submission. Kiosk orders use the existing `customer_orders` and `order_items` tables and decrement inventory through the shared order service.

Before enabling kiosk checkout against the existing Project 2 database, run `database/project2/sql_files/allow_kiosk_orders.sql` once. It allows `employee_id` to be `NULL` for customer-submitted orders; manager reports already use a left join when showing employee names. Do not run this migration against a different database without reviewing it.

## Remaining Project 3 work

This is the Project 2 migration, not a complete Project 3 submission. Customer
Kiosk, Kitchen Display (for this five-person team), external authentication,
translation, weather, personal assistant, accessibility-persona validation,
user studies, and the team's approved beyond features remain separate work.
The assignment also requires version control in the class GitHub organization;
coordinate how this deployment repository mirrors or connects to that repository.
