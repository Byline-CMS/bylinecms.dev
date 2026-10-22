---
'@byline/core': minor
'@byline/client': minor
---

Add provider-neutral integer range facets with `SearchRangeFacetRequest`,
`SearchRangeFacetBucket`, and `MAX_RANGE_FACET_BUCKETS` (200). Collection and zone
search validate capability support, bounds, bucket counts, unique fields, and
integer filter declarations before forwarding requests. Returned buckets pass
through unless row or collection authorization restricts aggregates.

Add the optional advertise-only `structuredFilters` capability so hosts can
detect providers that apply `where`, without changing existing forwarding.
The built-in PostgreSQL and MySQL providers leave both new capabilities unset.
