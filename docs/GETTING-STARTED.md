# Getting Started

Byline is in early beta. It builds and runs if you'd like to poke around or
follow along.

## 1. Clone and install dependencies

```sh
# git clone this repo
git clone git@github.com:Byline-CMS/bylinecms.dev.git
cd bylinecms.dev
# install rimraf global
pnpm install -g rimraf
# or npm install -g rimraf
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
cp .env.example .env
pnpm tsx --env-file=.env byline/seed.ts
```

## 3. Start dev mode

Again, from the root of the project, start the dev environment.

```sh
pnpm dev
```

If you've built the project (above) and have Postgres up and running, you
should be able to view the prototype on http://localhost:5173/.

Enjoy and stay tuned!
