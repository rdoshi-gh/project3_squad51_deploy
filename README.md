# web_app

ExpressJS with PostgreSQL example.

## Local development

From `webapp/`, run `npm ci` and `npm start`. Supply the database settings in
`webapp/.env` using the variable names below.

## Deploy to Vercel

Import this repository in Vercel and set **Root Directory** to `webapp`.
Vercel detects the Express app in `index.js`; no build command or output
directory override is needed.

Set these environment variables in the Vercel project for Production (and
Preview if needed):

- `PSQL_HOST`
- `PSQL_USER`
- `PSQL_DATABASE`
- `PSQL_PASSWORD`
- `PSQL_PORT`

The PostgreSQL server must accept connections from Vercel. The `/user` route
expects a `teammates` table with `first_name` and `last_name` columns.
The homepage at `/` does not require a database connection.

To deploy using the CLI, run `vercel --prod` from `webapp/` after signing in
with `vercel login`. Configure the project environment variables before deploying.
Keep `.env` and `.vercel/` out of Git.
