# @byline/search-mysql

## 4.9.0

### Minor Changes

- added portable multilingual search analysis with built-in PostgreSQL and MySQL full-text providers, shared provider conformance, and original-text highlighted snippets
  hardened query analysis against quadratic identifier scanning and preserved SKU/version constituent recall
- 78726f3: Added the built-in MySQL full-text `SearchProvider`, backed by portable
  multilingual analysis, weighted MySQL `FULLTEXT` indexes, driver-owned
  migrations, analyzer-fingerprint enforcement, and the shared provider
  conformance suite. Ranked hits include portable highlighted snippets from the
  stored original body text.

  Documented and wired `@byline/db-mysql` installations to use the real search
  provider instead of a no-op workaround. Fingerprint checks use collection
  metadata rather than scanning indexed documents, and phrase translation now
  emits only the source and expansion-kind variants represented by physical
  matching streams.

### Patch Changes

- Updated dependencies
- Updated dependencies [635c16a]
- Updated dependencies [78726f3]
  - @byline/core@4.9.0
  - @byline/search-analysis@4.9.0
