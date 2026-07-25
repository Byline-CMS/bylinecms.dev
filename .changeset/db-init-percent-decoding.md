---
"@byline/db-postgres": patch
---

`db_init.sh` now percent-decodes the user and password in `BYLINE_DB_POSTGRES_CONNECTION_STRING`, matching what node-postgres itself does when it parses the same string. Previously the script's URL parser split the connection string without decoding, so a password written `pa%40ss` created the database role with the literal `pa%40ss` while the adapter connected as `pa@ss` — an access-denied failure with nothing pointing at the cause.

The script now also rejects a malformed percent-escape (a `%` not followed by two hex digits) with a clear message rather than passing it through. This is stricter than before: a connection string whose password contains a raw, un-encoded `%` — which RFC 3986 requires be written `%25` — is refused by `db_init.sh` where it was previously accepted. Such a string was already failing on the adapter side, where node-postgres throws `URIError: URI malformed` on the same input.

Connection strings containing no percent-encoding are unaffected.
