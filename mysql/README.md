# Local MySQL (Docker)

The Byline MySQL adapter development database runs in Docker via
`docker-compose.yml`, driven by the `mysql.sh` helper.

```sh
./mysql.sh up -d       # Start MySQL (detached)
./mysql.sh down        # Stop and remove the container
```

The container provisions a `byline` user (password `byline`) and a `byline_dev`
database on first start, alongside the `root` account (password `test`).

Data persists in `./data` (gitignored). Connection settings and the database
name are configured in `docker-compose.yml` and the workspace `.env` files
(`apps/webapp/.env`, `packages/db-mysql/.env`).

For initializing and seeding the database, generating/applying migrations, and
the test database, see the root `CLAUDE.md` (Database section) and
`docs/09-testing.md`.

## Adminer

A web-based database UI is available under the `adminer` compose profile:

```sh
./mysql.sh --profile adminer up -d     # Start MySQL + Adminer
```

Then browse to <http://localhost:9000>. Log in with server `db`, username
`byline`, password `byline`, database `byline_dev` (or `root` / `test`).

## Installing the MySQL 8 client tools (Debian/Ubuntu)

The container ships its own server; these steps are only needed if you want the
`mysql` client on the host.

```sh
# 1. Update and install prerequisites
sudo apt update
sudo apt install gnupg2 wget lsb-release

# 2. Download and install the MySQL APT config package
wget https://dev.mysql.com/get/mysql-apt-config_0.8.33-1_all.deb
sudo dpkg -i mysql-apt-config_0.8.33-1_all.deb

# 3. Update the package list
sudo apt update

# 4. Install the client tools
sudo apt install mysql-client
```

## Installing the MySQL 8 client tools (macOS)

```sh
brew install mysql-client
```
