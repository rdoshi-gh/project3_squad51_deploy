# Popping POS (Team 51)

Project 2's Java Swing workflows ported to the repository's Express/EJS web app,
using the existing PostgreSQL database. The shared team database already includes
the employee scheduler table. Local development reuses that database; do not reseed
it. A separate database needs the schema additions for the features being used.

## Team development map

- `webapp/index.js`: Render/local HTTP server and test entry point.
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

The portal opens the cashier or manager employee-selection screen. Confirming
Log Out clears the session and returns to the existing portal to choose a view.
Other navigation stays within the selected employee workspace.

## Included workflows

- Cashier: category/search menu, quantities, sweetness, ice, toppings, line edits,
  removal, reset, undo/redo, review, order completion, employee profile, and a
  read-only published schedule opened from the top-bar Schedule button.
- Checkout: server-side menu prices, topping quantities, recipe-based stock
  deductions, stock availability checks, and atomic order/inventory writes.
- Manager: dashboard, date-filtered order history and details, ordering trends,
  inventory CRUD, physical counts, reorder-level review, and a Schedule section
  for assigning and publishing employee shifts.
- Restocking: create supply reorder requests and view their history. Requests
  do not increase stock; physical counts update inventory after receipt.
- Employees: add, edit, and delete records when order history and saved shifts
  allow it.
- Menu: add, edit, and delete items, change prices/categories, and manage recipes.
- Reports: Daily Sales Summary, Top Selling Items, Inventory Status, X Report
  (hourly sales), Sales Report, Restock Report, and Product Usage charts.
  Product Usage includes Last 7 Days, Last 30 Days, and All Time shortcuts.
  Every report offers Table View and Graph View buttons, showing only the selected
  view. Tables are the default; each report remembers its selection while on the page.
  Item sales charts rank units or estimated revenue; inventory and restock charts
  group quantities by unit. Product Usage compares period consumption with current
  stock, which is a present-day snapshot rather than historical ending inventory.
  Reports reload when settings change; Refresh Report reloads the same settings.

The original `/user` teammates example remains available for deployment parity;
it requires the original `teammates` table and is not part of the POS workflow.

## Employee scheduler

Managers open **Schedule** in the sidebar. The calendar shows employees as rows
and Monday–Sunday as columns. Click **+ Add shift** to assign an employee, date,
start/end times, and role. Select a shift to edit or delete it. Weekly employee
hours and daily staffing totals update with the draft.

Changes save as drafts. **Publish week** replaces that week's cashier schedule;
cashiers continue seeing the last published shifts while managers make edits.
Publishing an empty draft clears the published week. **Copy previous week** copies
the previous week's draft shifts into an empty draft week without overwriting
existing draft shifts. Cashiers can view published team shifts with the
**Schedule** button in their top bar, but cannot edit or publish them.

Scheduling uses one table, `employee_shifts`, linked to `employees`. Draft and
published copies share that table. It is already created in the shared team
database; teammates connecting to that database need no additional setup.
Times are store-local Central time. Shifts must finish later on the same day;
split overnight shifts across days. Overlapping shifts for the same employee
are rejected; consecutive shifts are allowed. Hours do not deduct breaks.

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

## Authentication

**Employees** (manager, cashier) keep Project 2's employee-selection
sign-in. It issues a signed, HTTP-only, one-hour cookie, enforces
cashier/manager routes, and rejects cross-origin browser writes. Selecting an
employee does not verify identity. A production deployment requires
`SESSION_SECRET`; without it, employee sign-in is unavailable.

**Kitchen display** opens directly at `/kitchen` without sign-in. Viewing the
queue and marking orders ready are public actions. Old `/kitchen/login` links
redirect to the display. Opening it does not change an existing employee session.

**Customers** can optionally sign in on the kiosk with Google (OAuth 2.0
authorization code flow, `webapp/lib/google-auth.js`) to earn loyalty points;
guests can still order. The callback verifies the signed `state` cookie and the
ID token's issuer, audience, nonce, expiry, and `email_verified`. First sign-in
creates a `customers` row. Each kiosk order earns 1 point per whole dollar,
credited in the same transaction as the order. Customer sessions last 15 minutes
and end after checkout, since the kiosk is shared.

**Lifetime Points.** Run `database/add_lifetime_points.sql` after
`database/add_customers.sql` before deploying this branch. This adds a separate
earned-points counter without changing redeemable balances. Existing accounts
start at zero because previous redemption totals were not stored. Each signed-in
purchase adds its earned points to both counters inside the order transaction;
redemptions reduce only the redeemable balance. Failed orders roll back both.
The migration can be run again without resetting tracked Lifetime Points.

**Leaderboard API.** Run `database/add_leaderboard_profiles.sql` after the
Lifetime Points migration. `GET /api/kiosk/leaderboard` returns the Top 10
customers with positive Lifetime Points. Equal scores share a rank (1, 1, 3);
customer ID orders equal scores consistently at the ten-customer cutoff.
Signed-in customers also receive their own rank, even outside the Top 10.
Customers with zero Lifetime Points are unranked. Google email addresses are
never returned. Names default to `Boba fan #<id>` until customers choose a public
display name through `PATCH /api/kiosk/leaderboard/profile`, authenticated with
the existing Google customer session.

The public `/leaderboard` page is linked from the kiosk and shares its styling,
accessibility controls, and translation support. Google sign-in started from
this page returns there after authentication. A signed-in customer can see their
own rank, Lifetime Points, and separate redeemable balance, and can choose or
change their public display name. Zero-point customers receive a clear unranked
state. Refresh preserves unsaved name edits; a successful save refreshes the
ranking.

The kiosk and personal leaderboard panel also show progress toward the next
reward using the redeemable balance and the server's existing reward catalog.
Lifetime Points do not determine reward eligibility. Reaching the highest tier
shows a completed indicator; checkout still validates the order subtotal.

To preview sample leaderboard records without changing team data, run `node test/leaderboard-preview.js`
from `webapp` and open `http://localhost:3002/leaderboard`. The optional
`/preview/customer` shortcut uses a local test session; it exists only in this
preview script and is never registered by the production server.

**Redeeming points.** At checkout, a signed-in customer can apply one reward
from the catalog in `webapp/lib/rewards.js`: 25 points for $2 off, 50 points
for $5 off, or 100 points for $12 off. The server validates the reward ID, rejects
rewards larger than the order subtotal, and spends and earns points in one guarded
`UPDATE ... WHERE points >= cost` inside the order transaction, so a balance can't
go negative or be spent twice. Points are earned on the amount actually paid, and
`customer_orders.total_price` stores that discounted total so revenue reports
reflect redemptions. `GET /api/kiosk/rewards` returns the catalog and the
signed-in customer's balance. Guests cannot redeem.

Setup:

1. Run `database/add_customers.sql` once.
2. In Google Cloud Console, create an OAuth client ID (Web application) with
   redirect URIs `http://localhost:3000/auth/google/callback` and
   `https://<render-host>/auth/google/callback`. While the consent screen is in
   Testing, add each Google account (including `reveille.bubbletea@gmail.com`)
   as a test user.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `webapp/.env` and in
   Render. `APP_BASE_URL` optionally overrides the host used for the redirect URI.
   The kiosk hides the Google button until both are set.

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

## Render deployment

Live site: https://popping-pos-squad51-z8cf.onrender.com

The production service is managed by the **Popping POS Team 51** Blueprint in
Render's **My Workspace**. Service dashboard:
https://dashboard.render.com/web/srv-dbpo1lec6qcc73e3g2hg
The service name has a Render-generated suffix; the Blueprint tracks its identity.

[Deploy this repository on Render](https://dashboard.render.com/select-repo?type=blueprint&repo=https%3A%2F%2Fgithub.com%2Frdoshi-gh%2Fproject3_squad51_deploy)
using the root `render.yaml` Blueprint. It creates the `popping-pos-squad51`
Node web service from `main`, with `webapp` as the root directory,
`npm ci` as the build command, and `npm start` as the start command.
The service listens on `0.0.0.0` using Render's `PORT` and checks `/api/health`.
Pushes to `main` automatically deploy.

The Blueprint generates a stable `SESSION_SECRET` and sets `NODE_ENV=production`.
Supply the existing database credentials privately when Render prompts for:

- `PSQL_HOST`
- `PSQL_USER`
- `PSQL_DATABASE`
- `PSQL_PASSWORD`

`PSQL_PORT` defaults to `5432`; change it if your database uses another port.
The existing PostgreSQL database and its data are reused. No seed, schema,
or database reset command runs during build or startup. The database must allow
connections from the Render service. Keep `.env` and all secret values out of Git.

The Blueprint selects Render's free plan. Free services sleep when idle, so the
first request after inactivity can take longer. See [Render's free service
limits](https://render.com/docs/free). Review the authentication scope above.

After deployment, verify `/`, `/api/health`, `/static/style.css`, both employee
login pages, and a successful employee session. Verify HTTPS from school Wi-Fi
as well; that network check must be performed on the school's connection.
Vercel automatic deploys are disconnected. Use the Render URL for the application.
To stop traffic to the old Vercel deployment, run the following interactively
and type the project name when Vercel asks (the CLI requires human confirmation):

```sh
vercel project pause project3-squad51-deploy --scope rdoshi-ghs-projects
```

## Customer Kiosk

The public Customer Kiosk is available at `/kiosk` and is linked from the Portal Hub. It reads menu items from `/api/kiosk/menu`, supports drink search and category filters, sweetness/ice/topping customizations, cart editing, and public order submission. Kiosk orders use the existing `customer_orders` and `order_items` tables and decrement inventory through the shared order service.

Kiosk checkout currently records orders under employee ID `6`; that employee
record must exist in the connected database. The legacy
`database/project2/sql_files/allow_kiosk_orders.sql` script allows a null employee
ID, but the current kiosk route does not submit null employee IDs.

## Accessibility controls and Spanish translation

The portal, employee sign-in pages, kiosk, cashier, manager (including Customer
Orders/order history and reports), kitchen display, error page, and teammates
example all expose the same Accessibility menu. Text size (90–150%), control
size (100–150%), high contrast, text spacing, and language preferences carry
between pages in the same browser using local storage. These support the team's
selected Maria, Vishnu, and Carol personas; persona evaluation is still required.
The kitchen retains its own design stylesheet while loading shared accessibility
styles/scripts. Unchanged kitchen polling preserves existing cards and keyboard
focus. New cards and dialogs receive the active settings automatically.
On narrow screens the menu is fixed within the viewport and can scroll; Escape
closes it and returns focus to the Accessibility button. In high contrast,
report comparison bars use solid and striped fills to remain distinguishable.
Employee/customer names and input values are excluded from translation requests.

On any page, choose Accessibility → Language / Idioma → Español. The app
translates page text, accessible labels, placeholders, menu names/categories,
customization dialogs, cart details, and confirmation messages. New or renamed
database menu items are translated when loaded; no code dictionary needs updating.
Kiosk, cashier, and manager record searches accept English or translated Spanish
names (with or without accents).
Switching back to English restores the original text without clearing the order
or changing form selections. Customer names, typed input, prices, and item IDs
are preserved. The language preference uses the existing accessibility storage.
Short ordering terms such as sweetness and ice use reviewed Spanish labels to
avoid ambiguous dictionary matches. New menu names and other page text use the API.

The server calls [MyMemory's keyless API](https://mymemory.translated.net/doc/spec.php)
through `/api/translate`; no API key is needed.
Anonymous usage is limited to [5,000 characters per day](https://mymemory.translated.net/doc/usagelimits.php).
Set `MYMEMORY_EMAIL` to a valid contact email in the private `webapp/.env` and
Render's Environment settings to use the documented free 50,000-character daily
allowance. No account signup is required. This email is sent to MyMemory as the
server-side `de` parameter; it is not embedded in the page or translation responses.
The Blueprint declares this setting but its value must be supplied privately.
The server caches successful source-text translations for 24 hours (up to 2,000
segments per process), shares concurrent lookups, and limits requests per client.
Caches reset when the server restarts; deployment instances have separate caches.
Page/menu text is sent to MyMemory, but customer-name elements and input values
are excluded. Translations are machine generated and may be imperfect.

If a request fails or the free quota is exhausted, untranslated text stays usable
in English and a bilingual notice offers Retry / Reintentar. The language menu
always retains both language names so users can return to English. Successful
segments remain cached when retrying. A production service with higher traffic
may need a translation provider with a larger quota.

When MyMemory responds with HTTP 429, the server stops queued provider lookups
and shares a cooldown across clients in that server process. It honors the
provider's `Retry-After` header, or waits one minute when no valid reset time is
provided. Cached translations remain available. The browser shows a bilingual
rate-limit notice and disables Retry until the cooldown ends; it does not retry
automatically. This reduces repeated requests but cannot lift a provider quota
or guarantee that the provider accepts requests after the waiting period.

For deployment troubleshooting, retry Spanish on the live app and inspect Render's
Logs for `Translation provider failure:`. The entry records whether a contact
email is configured, how many segments failed, and the failure stage plus available
HTTP/provider status or connection error code. Rate-limit failures also include
the remaining cooldown in `retryAfterSeconds`. It excludes the email value,
source text, and request URLs. These diagnostics identify failures; they do not
resolve provider limits or connection problems automatically.

On a Windows network that uses a locally trusted certificate authority, Node may
report `UNABLE_TO_VERIFY_LEAF_SIGNATURE` for outbound HTTPS even though the browser
works. With Node 22.19+ or Node 24.6+, use the system trust store (certificate
verification stays enabled). In PowerShell, set `$env:NODE_USE_SYSTEM_CA = '1'`
before `npm start`. This was needed and verified on the local development machine.

Validate with `node --test test/translation.test.js test/accessibility-pages.test.js`.
Tests use a mocked provider
and sample menu data; they never consume translation quota or write team records.
For manual checking, run `npm start`, switch to Spanish on `/kiosk`, customize a
drink, review the cart, then switch back to English. To check a new menu item,
use an isolated/sample database or an approved test item, reload the kiosk menu,
and verify its name and category translate. Translation alone does not demonstrate
all of Maria's persona requirements; document and evaluate additional support
for her mobile, bilingual, and plain-language needs separately.

## Remaining Project 3 work

The app includes the customer kiosk, kitchen display, Google customer sign-in,
Spanish translation, weather, loyalty/leaderboard features, and employee scheduling.
Translation on Render is still being diagnosed. Personal assistant work,
accessibility-persona validation, user studies, and assignment acceptance checks
remain to be completed or confirmed by the team.
The assignment also requires version control in the class GitHub organization;
coordinate how this deployment repository mirrors or connects to that repository.

### Kiosk weather (OpenWeather)

The customer kiosk displays local conditions in a small card on its welcome and
menu screens. Set `OPENWEATHER_API_KEY` in `webapp/.env` for local development,
or in the web service's environment settings for deployment, then restart the
app. Get a key from [OpenWeather](https://home.openweathermap.org/api_keys).
The key is used only by the server and is never sent to the browser.

The default location is College Station, TX. To change the store location, set
`OPENWEATHER_LAT`, `OPENWEATHER_LON`, and `OPENWEATHER_LOCATION` together.
Temperatures display in Fahrenheit. Current readings are cached for ten minutes;
failed requests back off for one minute. If the key is missing or the provider
is unavailable, the card shows a friendly unavailable message and ordering
continues normally. No customer location permission is needed.

### Poppy kiosk chatbot (TAMUS AI Chat)

Poppy answers menu and ordering questions from a kiosk dialog. Its server request
includes current public menu names, categories, prices, and ordering/reward rules.
It cannot modify carts or place orders. Answers are AI generated; ingredient,
allergy, nutrition, stock and wait-time questions should be checked with staff.

In `webapp/.env` locally (or your hosting service's environment), set:

- `TAMUS_AI_CHAT_API_KEY`: your Texas A&M TAMUS AI Chat key.
- `TAMUS_AI_CHAT_API_ENDPOINT`: `https://chat-api.tamu.ai` for Texas A&M University.
- `TAMUS_AI_CHAT_MODEL`: an exact OpenAI model ID returned by your account's
  `GET /api/models` endpoint. Select a GPT-4.1 mini variant if offered for a small,
  fast menu assistant; use the exact ID, including any provider prefix.

Restart the server after changes. The implementation uses bearer authentication
and `POST /api/chat/completions`, as documented in the
[TAMUS key guide](https://docs.tamus.ai/docs/prod/api-tool/create-and-test-api-key/).
TAMUS requires at least one chat in its web console before using a key, plus
creating/updating a chat at least once every 30 days to keep the key usable.

The key stays server-side. Only questions and up to four recent question/answer
pairs are sent with the menu context; customer accounts, names, orders and cart
contents are not automatically included. Chat is kept in page memory, clears
after three minutes without a new question, and clears when the cart becomes
empty. Users can also select Clear chat. Avoid entering personal information.
The public endpoint allows 20 requests per minute and three simultaneous requests
per server process, with bounded messages and a 20-second upstream timeout.
Multiple deployment instances each have their own quota. Missing configuration
and upstream failures show a friendly message without breaking ordering.
