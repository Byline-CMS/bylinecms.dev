#!/usr/bin/env bash
#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#  Convenience wrapper: initialise the dedicated test database (byline_test).
#  Equivalent to: ./db_init.sh --env-file ../../.env.test

exec ./db_init.sh --env-file ../../.env.test "$@"
