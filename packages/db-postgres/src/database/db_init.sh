#!/usr/bin/env bash
#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#  Script to drop and recreate a Byline database (dev or test).
#
#  Usage:
#    ./db_init.sh                          # uses ../../.env (DB name in BYLINE_DB_POSTGRES_CONNECTION_STRING must end _dev or _test)
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

echo "Initializing DB '${POSTGRES_DATABASE}' (enter postgres root password below)"
sed -e "s/\${db_name}/${POSTGRES_DATABASE}/" \
    -e "s/\${db_user}/${POSTGRES_USER}/" \
    -e "s/\${db_pass}/${POSTGRES_PASSWORD_ESC}/" db-reset.sql.template \
  | psql -h 127.0.0.1 -U postgres -q
