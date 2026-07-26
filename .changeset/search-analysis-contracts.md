---
"@byline/core": minor
"@byline/client": minor
"@byline/search-analysis": minor
---

Added provider-neutral lexical matching contracts and
`@byline/search-analysis`, a portable multilingual analysis and query-planning
package. The analyzer preserves exact terms, validates locale declarations,
uses ICU word boundaries, protects domain identifiers, emits optional
language-specific variants and Han bigrams, and records a stable fingerprint
for reindex decisions. Collection and zone search now pass explicit all/any,
minimum-should-match, and phrase intent to search providers. Search providers
must declare their lexical capabilities and implement index clearing so every
derived projection remains explicitly rebuildable.
