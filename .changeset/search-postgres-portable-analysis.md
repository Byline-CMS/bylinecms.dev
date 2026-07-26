---
"@byline/search-postgres": minor
---

Replaced PostgreSQL-native lexical analysis with the shared portable
multilingual analyzer and query plan. The adapter now supports all/any,
minimum-should-match, phrases, protected identifiers, exact-preserving
expansions, ordered Han-bigram fallback, and analyzer-fingerprint rebuild
guards through one weighted `tsvector`.

This is a direct cutover for the disposable search projection: reset the
provider-owned search tables, apply the rewritten `0001_init.sql`, and rebuild
published indexes. There is no native compatibility mode or in-place search
migration.
