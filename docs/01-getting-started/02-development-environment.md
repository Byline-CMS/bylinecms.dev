---
title: "Development environment and example application"
path: "getting-started-development-environment"
summary: "Clone the Byline CMS repo, provision PostgreSQL, seed the database, and run the example application (apps/webapp) in dev mode."
---

This is the development environment and example application (this repo).

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

:::warning[Foot-gun protection]
Our `./db_init` script sources (imports) `common.sh`, which has a guarded
check that will only allow `_dev` or `_test` databases to be initialized or
reset.
:::

```sh
# You can optionally run pnpm drizzle:generate, although since
# this is a development repo - migrations have already been generated
# and committed.
# pnpm drizzle:generate
pnpm drizzle:migrate
```

### 2.3. Configure the webapp, and optionally seed documents

```
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
# past the above output into your .env.local file for
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
