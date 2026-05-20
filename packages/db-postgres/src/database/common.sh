#!/usr/bin/env bash

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# FUNCTION: get_required_input
# Get user input from the terminal.
# Params: $1 = the message prompting the user.
# Params: $2 = the error message if no input is received.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
get_required_input() {
  if [ -z "$1" -o -z "$2" ]; then
    echo "get_required_input requires a prompt and an error message as first and second parameters." >&2
    exit 1
  fi

  while true; do
    echo -n "$1" >&2
    read input
    if [ -z "$input" ]; then
      echo "$2" >&2
    else
      break
    fi
  done
  echo $input
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# FUNCTION: check_conf_var
# Sanity check to ensure variable is defined, and exit if not
# Params: $1 = Name of the variable
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
check_conf_var() {
  if [[ -z ${!1} ]]
  then
    echo "$1 not defined"
    CONF_BAD=true
  fi
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# FUNCTION: parse_pg_url
# Parse a Postgres connection URL into POSTGRES_USER, POSTGRES_PASSWORD,
# POSTGRES_HOSTNAME, POSTGRES_PORT, POSTGRES_DATABASE. The single env var
# BYLINE_DB_POSTGRES_CONNECTION_STRING is the source of truth; the
# downstream sed templates here and in db_init.sh consume the individual
# variables. Expected shape:
#
#   postgres://user:password@host:port/database
#
# Strips `?...` query string. Defaults POSTGRES_PORT to 5432 if absent.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
parse_pg_url() {
  local url="$1"
  if [[ -z "${url}" ]]; then
    echo "BYLINE_DB_POSTGRES_CONNECTION_STRING not defined"
    CONF_BAD=true
    return
  fi
  if [[ "${url}" != postgres://* && "${url}" != postgresql://* ]]; then
    echo "BYLINE_DB_POSTGRES_CONNECTION_STRING must start with postgres:// or postgresql://"
    CONF_BAD=true
    return
  fi

  local rest="${url#*://}"

  if [[ "${rest}" != *@* ]]; then
    echo "BYLINE_DB_POSTGRES_CONNECTION_STRING is missing user:password@ portion"
    CONF_BAD=true
    return
  fi

  # Split on the LAST `@` so passwords containing `@` survive.
  local userinfo="${rest%@*}"
  local hostpart="${rest##*@}"

  if [[ "${userinfo}" != *:* ]]; then
    echo "BYLINE_DB_POSTGRES_CONNECTION_STRING is missing user:password@ portion"
    CONF_BAD=true
    return
  fi

  POSTGRES_USER="${userinfo%%:*}"
  POSTGRES_PASSWORD="${userinfo#*:}"

  local hostport="${hostpart%%/*}"
  local dbpath="${hostpart#*/}"

  if [[ "${hostport}" == *:* ]]; then
    POSTGRES_HOSTNAME="${hostport%%:*}"
    POSTGRES_PORT="${hostport#*:}"
  else
    POSTGRES_HOSTNAME="${hostport}"
    POSTGRES_PORT="5432"
  fi

  POSTGRES_DATABASE="${dbpath%%\?*}"
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# FUNCTION: check_db_suffix
# Foot-gun guard: refuse to continue unless POSTGRES_DATABASE ends in
# `_dev` or `_test`. Replaces the previous hard-coded `byline_dev`
# assignment so the same scripts can target a dedicated test database
# (e.g. `byline_test`) without ever pointing at a production-shaped name.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
check_db_suffix() {
  if [[ "${POSTGRES_DATABASE}" != *_dev && "${POSTGRES_DATABASE}" != *_test ]]
  then
    echo "Refusing to operate on database='${POSTGRES_DATABASE}'."
    echo "These scripts will only target a database whose name ends in '_dev' or '_test'."
    CONF_BAD=true
  fi
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# Resolve which .env file to source. Callers may set ENV_FILE before
# sourcing this script (db_init.sh forwards a `--env-file <path>` arg)
# to switch between dev and test environments. Defaults to ../../.env,
# which resolves to packages/db-postgres/.env from src/database/.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
: "${ENV_FILE:=../../.env}"

if [[ -e "${ENV_FILE}" ]]
then
  source "${ENV_FILE}"
else
  echo "env file not found: ${ENV_FILE}"
  exit 1
fi

CONF_BAD=false
check_conf_var BYLINE_DB_POSTGRES_CONNECTION_STRING
if $CONF_BAD; then exit 1; fi

parse_pg_url "${BYLINE_DB_POSTGRES_CONNECTION_STRING}"
if $CONF_BAD; then exit 1; fi

check_db_suffix
if $CONF_BAD; then exit 1; fi

# Escape for postgresql -- the password will appear in our generated sql as a
# single-quoted string literal, so we need to insert a ' character before
# every ' in the original password.  No other escaping is necessary.
# https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-CONSTANTS
POSTGRES_PASSWORD_ESC=$(sed -e "s/[']/'&/g" <<< $POSTGRES_PASSWORD)

# Escape for sed -- we'll use the password as a sed replacement pattern,
# meaning we must insert a \ character before every \, / and & character
# in the sql-escaped password from above.
# https://stackoverflow.com/questions/407523/escape-a-string-for-a-sed-replace-pattern/2705678#2705678
POSTGRES_PASSWORD_ESC=$(sed -e 's/[\/&]/\\&/g' <<< $POSTGRES_PASSWORD_ESC)
