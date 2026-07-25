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
# `parse_pg_url` below extracts the user/password substrings from the
# connection string by plain string manipulation — it does not decode
# percent-escapes. But the running application hands the same connection
# string to node-postgres, which parses it as a real URL and DOES
# percent-decode the userinfo (username/password) component. Left
# undecoded here, a password containing a character that had to be
# percent-encoded in the URL (`@`, `#`, `/`, `%`, `'`, a literal `\`, …)
# would make `db_init.sh` create the Postgres role with the literal
# percent-escaped string as its password, while the running application
# connects with the decoded password — "password authentication failed,"
# with nothing about the error pointing at the real cause. See
# `packages/db-mysql/src/database/common.sh`'s identical helper — mysql2
# decodes the same way.
#
# Deliberately does NOT decode `+` to space: that is HTML form encoding
# (`application/x-www-form-urlencoded`), which is a different convention
# from URL-userinfo percent-encoding and is not what node-postgres or
# mysql2 do when parsing a connection string.
#
# Escapes literal backslashes in the input *before* handing it to
# `printf %b`, which otherwise treats `\` as the start of its own escape
# sequence and would mangle a password that legitimately contains one.
#
# Rejects a malformed percent-escape (a `%` not followed by exactly two
# hex digits) instead of silently mis-decoding it — `printf %b` either
# swallows a short/invalid escape into garbage bytes or prints its own
# "missing hex digit" warning to stderr while still exiting 0, and either
# way the caller would otherwise sail on with a corrupted value. A raw,
# un-encoded `%` in a connection string violates RFC 3986, so this is
# exactly the input node-postgres would independently reject with
# `URIError: URI malformed` — failing here just fails at the same input
# with a message that names the actual problem instead of a downstream
# "password authentication failed."
#
###~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~##
urldecode() {
  local encoded="$1"
  if [[ "${encoded}" =~ %([^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|[0-9A-Fa-f]?$) ]]; then
    echo "urldecode: malformed percent-escape in '${encoded}' -- every '%' must be followed by exactly two hex digits (e.g. '%40')" >&2
    return 1
  fi
  encoded="${encoded//\\/\\\\}"
  printf '%b' "${encoded//%/\\x}"
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
# POSTGRES_USER and POSTGRES_PASSWORD are percent-decoded (see
# `urldecode` above) so a password with URL-reserved characters resolves
# to the same literal value node-postgres resolves it to.
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

  POSTGRES_USER="$(urldecode "${userinfo%%:*}")" || { CONF_BAD=true; return; }
  POSTGRES_PASSWORD="$(urldecode "${userinfo#*:}")" || { CONF_BAD=true; return; }

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

# Escape the username for the same sed substitution in db_init.sh. Before
# `urldecode` (above) existed, a raw `/`, `&`, or `\` in the username was
# structurally impossible — it would have broken URL parsing before
# `parse_pg_url` ever ran. Now a percent-encoded username (`%2F`, `%26`,
# `%5C`) decodes into exactly those sed-special characters and reaches
# db_init.sh's `s/${db_user}/.../ ` substitution unescaped, corrupting
# the generated SQL (or, for `&`, silently substituting the whole
# matched text instead of the literal username). Unlike the password,
# the username never appears through this script as a SQL string literal
# that also needs quote escaping — it only ever reaches sed as a
# replacement value — so it gets this one escaping stage and not the
# SQL-literal stage above.
POSTGRES_USER_ESC=$(sed -e 's/[\/&]/\\&/g' <<< $POSTGRES_USER)
