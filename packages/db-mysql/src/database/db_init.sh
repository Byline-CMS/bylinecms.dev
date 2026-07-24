#!/usr/bin/env bash
#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#  Script to drop and recreate a Byline database (dev or test).
#
#  Usage:
#    ./db_init.sh                          # uses ../../.env (DB name in BYLINE_DB_MYSQL_CONNECTION_STRING must end _dev or _test)
#    ./db_init.sh --env-file ../../.env.test
#
#  NOTE: Only do this if you are sure you know what you're doing.

# Parse args: --env-file <path>
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_FILE="${1#*=}"
      shift
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

export ENV_FILE

source common.sh

# Prefer a host `mysql` client if one is on PATH; otherwise fall back to the
# server container's own client via `docker exec`. Connect as root, taking
# the root password from MYSQL_ROOT_PASSWORD (defaulting to the compose
# file's `test`) via MYSQL_PWD so it doesn't appear in `ps` output or
# trigger the "password on the command line is insecure" warning. In both
# branches MYSQL_PWD is exported on the host and referenced by name only
# (`-e MYSQL_PWD` with no `=value`) so `docker exec` forwards the value from
# the calling shell's environment without it ever appearing in the
# `docker exec` argv itself.
: "${MYSQL_ROOT_PASSWORD:=test}"
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD}"

if command -v mysql >/dev/null 2>&1; then
  MYSQL_CLIENT=(mysql -h 127.0.0.1 -u root)
else
  MYSQL_CLIENT=(docker exec -i -e MYSQL_PWD byline_dev_mysql mysql -u root)
fi

echo "Initializing DB '${MYSQL_DATABASE}'"
sed -e "s/\${db_name}/${MYSQL_DATABASE}/" \
    -e "s/\${db_user}/${MYSQL_USER}/" \
    -e "s/\${db_pass}/${MYSQL_PASSWORD_ESC}/" db-reset.sql.template \
  | "${MYSQL_CLIENT[@]}"
