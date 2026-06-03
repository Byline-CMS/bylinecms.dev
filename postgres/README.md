# Local Postgres (Docker)

The Byline development database runs in Docker via `docker-compose.yml`, driven
by the `postgres.sh` helper.

```sh
./postgres.sh up -d     # Start Postgres (detached)
./postgres.sh down      # Stop and remove the container
```

Data persists in `./data` (gitignored). Connection settings and the database
name are configured in `docker-compose.yml` and the workspace `.env` files
(`apps/webapp/.env`, `packages/db-postgres/.env`).

For initializing and seeding the database, generating/applying Drizzle
migrations, and the test database, see the root `CLAUDE.md` (Database section)
and `docs/TESTING.md`.

## Installing the Postgres 16 client tools (Debian/Ubuntu)

The container ships its own server; these steps are only needed if you want
`psql` / `pg_dump` on the host.

```sh
# 1. Update and install prerequisites
sudo apt update
sudo apt install gnupg2 wget

# 2. Import the repository signing key
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo gpg --dearmor -o /etc/apt/keyrings/postgresql-archive-keyring.gpg

# 3. Add the PostgreSQL 16 repository
sudo sh -c 'echo "deb [signed-by=/etc/apt/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'

# 4. Update the package list
sudo apt update

# 5. (Optional) View available packages
apt search 'postgresql.*-16'

# 6. Install the client tools
sudo apt install postgresql-client-16
```
