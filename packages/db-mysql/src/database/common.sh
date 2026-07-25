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
# FUNCTION: urldecode
# Percent-decode a single URL component (RFC 3986 %XX escapes).
#
# `parse_mysql_url` below extracts the user/password substrings from the
# connection string by plain string manipulation — it does not decode
# percent-escapes. But `mysqlAdapter` hands the same connection string to
# mysql2, which parses it as a real URL and DOES percent-decode the
# userinfo (username/password) component. Left undecoded here, a password
# containing a character that had to be percent-encoded in the URL (`@`,
# `#`, `/`, `%`, `'`, a literal `\`, …) would make `db_init.sh` create the
# MySQL user with the literal percent-escaped string as its password,
# while the running application connects with the decoded password —
# "Access denied," with nothing about the error pointing at the real
# cause. See `packages/db-postgres/src/database/common.sh`'s identical
# helper — node-postgres decodes the same way.
#
# Deliberately does NOT decode `+` to space: that is HTML form encoding
# (`application/x-www-form-urlencoded`), which is a different convention
# from URL-userinfo percent-encoding and is not what mysql2 or
# node-postgres do when parsing a connection string.
#
# Escapes literal backslashes in the input *before* handing it to
# `printf %b`, which otherwise treats `\` as the start of its own escape
# sequence and would mangle a password that legitimately contains one.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
urldecode() {
  local encoded="$1"
  encoded="${encoded//\\/\\\\}"
  printf '%b' "${encoded//%/\\x}"
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# FUNCTION: parse_mysql_url
# Parse a MySQL connection URL into MYSQL_USER, MYSQL_PASSWORD,
# MYSQL_HOSTNAME, MYSQL_PORT, MYSQL_DATABASE. The single env var
# BYLINE_DB_MYSQL_CONNECTION_STRING is the source of truth; the
# downstream sed templates here and in db_init.sh consume the individual
# variables. Expected shape:
#
#   mysql://user:password@host:port/database
#
# Strips `?...` query string. Defaults MYSQL_PORT to 3306 if absent.
# MYSQL_USER and MYSQL_PASSWORD are percent-decoded (see `urldecode`
# above) so a password with URL-reserved characters resolves to the same
# literal value mysql2 resolves it to.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
parse_mysql_url() {
  local url="$1"
  if [[ -z "${url}" ]]; then
    echo "BYLINE_DB_MYSQL_CONNECTION_STRING not defined"
    CONF_BAD=true
    return
  fi
  if [[ "${url}" != mysql://* ]]; then
    echo "BYLINE_DB_MYSQL_CONNECTION_STRING must start with mysql://"
    CONF_BAD=true
    return
  fi

  local rest="${url#*://}"

  if [[ "${rest}" != *@* ]]; then
    echo "BYLINE_DB_MYSQL_CONNECTION_STRING is missing user:password@ portion"
    CONF_BAD=true
    return
  fi

  # Split on the LAST `@` so passwords containing `@` survive.
  local userinfo="${rest%@*}"
  local hostpart="${rest##*@}"

  if [[ "${userinfo}" != *:* ]]; then
    echo "BYLINE_DB_MYSQL_CONNECTION_STRING is missing user:password@ portion"
    CONF_BAD=true
    return
  fi

  MYSQL_USER="$(urldecode "${userinfo%%:*}")"
  MYSQL_PASSWORD="$(urldecode "${userinfo#*:}")"

  local hostport="${hostpart%%/*}"
  local dbpath="${hostpart#*/}"

  if [[ "${hostport}" == *:* ]]; then
    MYSQL_HOSTNAME="${hostport%%:*}"
    MYSQL_PORT="${hostport#*:}"
  else
    MYSQL_HOSTNAME="${hostport}"
    MYSQL_PORT="3306"
  fi

  MYSQL_DATABASE="${dbpath%%\?*}"
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# FUNCTION: check_db_suffix
# Foot-gun guard: refuse to continue unless MYSQL_DATABASE ends in
# `_dev` or `_test`. Replaces the previous hard-coded `byline_dev`
# assignment so the same scripts can target a dedicated test database
# (e.g. `byline_test`) without ever pointing at a production-shaped name.
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
check_db_suffix() {
  if [[ "${MYSQL_DATABASE}" != *_dev && "${MYSQL_DATABASE}" != *_test ]]
  then
    echo "Refusing to operate on database='${MYSQL_DATABASE}'."
    echo "These scripts will only target a database whose name ends in '_dev' or '_test'."
    CONF_BAD=true
  fi
}

###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
#
# Resolve which .env file to source. Callers may set ENV_FILE before
# sourcing this script (db_init.sh forwards a `--env-file <path>` arg)
# to switch between dev and test environments. Defaults to ../../.env,
# which resolves to packages/db-mysql/.env from src/database/.
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
check_conf_var BYLINE_DB_MYSQL_CONNECTION_STRING
if $CONF_BAD; then exit 1; fi

parse_mysql_url "${BYLINE_DB_MYSQL_CONNECTION_STRING}"
if $CONF_BAD; then exit 1; fi

check_db_suffix
if $CONF_BAD; then exit 1; fi

# Escape for MySQL -- the password will appear in our generated sql as a
# single-quoted string literal, so we need to insert a \ character before
# every \ and ' character in the original password.
# https://dev.mysql.com/doc/refman/8.4/en/string-literals.html
MYSQL_PASSWORD_ESC=$(sed -e 's/\\/\\\\/g' -e "s/[']/\\\\&/g" <<< $MYSQL_PASSWORD)

# Escape for sed -- we'll use the password as a sed replacement pattern,
# meaning we must insert a \ character before every \, / and & character
# in the sql-escaped password from above.
# https://stackoverflow.com/questions/407523/escape-a-string-for-a-sed-replace-pattern/2705678#2705678
MYSQL_PASSWORD_ESC=$(sed -e 's/[\/&]/\\&/g' <<< $MYSQL_PASSWORD_ESC)
