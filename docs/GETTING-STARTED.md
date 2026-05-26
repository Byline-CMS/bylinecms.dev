---
title: "Getting Started"
path: "getting-started"
summary: "The experimental Byline CLI: 'byline init' against an existing TanStack Start app, plus 'doctor' and other commands for adding Byline to a fresh project."
---

## Getting started - Experimental CLI

Note: We have an experimental CLI that will attempt to install Byline into an existing TanStack Start application. This has only been tested against up-to-date TanStack Start sites created with the Nitro (agnostic adapter). You can install TanStack Start with:

```sh
npx @tanstack/cli@latest create

#or

pnpm dlx @tanstack/cli@latest create
```
Then be sure to select the Nitro (agnostic) adapter.
```
◆  Select deployment adapter:
│  ○ None
│  ○ Cloudflare
│  ○ Netlify
│  ● Nitro (agnostic)
│  ○ Railway
└
```
Once your TanStack Start application is ready you can initialize a Byline installation with:

```sh
npx @byline/cli@latest init

# or

pnpm dlx @byline/cli@latest init
```
NOTE: If you use `pnpm` - installing dependencies may bail out asking you to `pnpm approve-builds`
You can stop the `cli@latest init` - approve builds, and then re-run `pnpm dlx @byline/cli@latest init` and
it will pick up where it left off. You may need to do this more than once.

If there are any issues, you can follow the example application in this repo under `apps/webapp`.

NOTE: For AI-assisted editing, you'll need to add your API keys as shown in `apps/webapp/.env.example`

IMPORTANT: The core Byline routes will be placed under a pathless route at `routes/_byline`, with its own route.tsx template. To prevent your front-end TanStack Start application's styling from 'leaking' into the Byline dashboard, you'll need to create or move your top-most layout route into its own pathless layout route - for example, under `routes/_font-end` or `routes/_public` - with any styling, headers, footers etc., that might have been in __root.tsx - moved into the route.tsx layout file inside your front-end pathless layout route.

See the TanStack Router docs for [File-Based Routing](https://tanstack.com/router/latest/docs/routing/file-based-routing) and [Virtual File Routes](https://tanstack.com/router/latest/docs/routing/virtual-file-routes) for more information.

NOTE: If you have manually configured Byline by copying code from the example application here (byline directories, .env, start, server, __root.tsx, and vite.config.ts settings), and only want to provision the database and seed the super-admin and example docs in the new application, use `byline setup` instead of `byline init`:

```sh
npx @byline/cli@latest setup

# or

pnpm dlx @byline/cli@latest setup
```

`setup` runs only the database-provisioning and seed phases (`db` → `db-init` → `seed-admin` → `seed-docs`) — it does not touch project files. Useful flag examples:

```sh
# Provision the DB and seed both the super-admin and example docs (default)
byline setup

# Provision the DB and seed the super-admin only
byline setup --no-seed-docs

# Provision the DB and seed example docs only
byline setup --no-seed-admin

# Provision the DB without running either seed
byline setup --no-seed-admin --no-seed-docs

# Destructive: drop and recreate the database (requires both flags)
byline setup --reset --i-mean-it

# Re-run every phase even if recorded as complete (non-destructive on its own —
# migrations re-apply as no-ops, seeds are idempotent)
byline setup --force

# Full nuke-and-pave: drop and recreate the database, then re-run every phase
byline setup --force --reset --i-mean-it
```

By default `setup` consults `.byline-install.json` and skips phases already recorded as complete. `--force` bypasses that and re-runs each phase against fresh state — useful after a manual DB reset, when you want to re-seed, or to re-verify a setup is healthy. A confirmation prompt fires before either of the `--force` flows runs (skippable with `-y`); the destructive `--reset` flow has its own confirm inside `db-init` unless `--i-mean-it` is also passed.

Before running any phase, `setup` performs a quick pre-flight: it bails if the core `@byline/*` packages aren't installed in your app's `package.json`, bails if `.env` is missing, and warns-and-confirms if `.env` is present but missing keys Byline expects (some keys may legitimately be supplied via shell env). For new TanStack Start apps that need the full scaffold, use `byline init` instead.


## Getting started - Development environment and example application (this repo)

Byline is shipping under the 1.x line — best treated as a release candidate.
It builds and runs if you'd like to poke around or follow along.

## 1. Clone and install dependencies

```sh
# git clone this repo
git clone git@github.com:Byline-CMS/bylinecms.dev.git
cd bylinecms.dev
# install deps
pnpm install
# build once so that all workspace packages and apps have their deps
pnpm build
```

## 2. Set up your database

Byline currently requires PostgreSQL. There is a `docker-compose.yml` in the
root `postgres` directory. Note that the default root password is set to
`test` in `docker-compose.yml`.

### 2.1. Create the `data` subdirectory and start Postgres

```sh
# From the root of the project
cd postgres
mkdir data
# If you want to run docker detached, run './postgres.sh up -d'
./postgres.sh up

# And then 'down' if you want to remove the Docker container and network
# configuration when you're done.
./postgres.sh down
```

### 2.2. Initialize the database and schema

Only the Postgres adapter is available at the moment.

```sh
# Copy .env.example to .env in the apps/dashboard directory.
# Read the notes in .env.example.
cd packages/db-postgres
cp .env.example .env

# Again, the default database root password is 'test'
# (assuming you're using our docker-compose.yml file).
cd src/database
./db_init.sh
cd ../..
```

> **Foot-gun protection.** Our `./db_init` script sources (imports)
> `common.sh`, which has a hardcoded value for the name of the development
> database. The script can only ever drop and recreate this database name. If
> you'd like to use a database name other than `byline_dev`, change the last
> line in `common.sh` as well as your corresponding `.env` settings.

```sh
# You can optionally run pnpm drizzle:generate, although since
# this is a development repo - migrations have already been generated
# and committed.
# pnpm drizzle:generate
pnpm drizzle:migrate

# Seed the database with a single super-admin user — and optionally,
# categories and documents.
# From /apps/webapp. Note that our seed scripts live in
# apps/webapp/byline/seeds, orchestrated by apps/webapp/byline/seed.ts
# (for now and for 'reasons').
cd apps/webapp

# .env configuration
cp .env.local.example .env.local

# generate JWT session key
openssl rand -base64 48
# past the above output into your .env file for
# BYLINE_JWT_SECRET=

# Set the seed superadmin username email address and password
# BYLINE_SUPERADMIN_EMAIL=admin@byline.local
# BYLINE_SUPERADMIN_PASSWORD=change-me

pnpm tsx --env-file=.env.local byline/seed.ts
```

## 3. Start dev mode

Again, from the root of the project, start the dev environment.

```sh
pnpm dev
```

If you've built the project (above) and have Postgres up and running, you
should be able to view the app on http://localhost:5173/.

Enjoy and stay tuned!
