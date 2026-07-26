---
"@byline/search-mysql": minor
"@byline/db-mysql": minor
"@byline/core": patch
---

Added the built-in MySQL full-text `SearchProvider`, backed by portable
multilingual analysis, weighted MySQL `FULLTEXT` indexes, driver-owned
migrations, analyzer-fingerprint enforcement, and the shared provider
conformance suite. Ranked hits include portable highlighted snippets from the
stored original body text.

Documented and wired `@byline/db-mysql` installations to use the real search
provider instead of a no-op workaround. Fingerprint checks use collection
metadata rather than scanning indexed documents, and phrase translation now
emits only the source and expansion-kind variants represented by physical
matching streams.
