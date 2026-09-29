---
"@byline/client": patch
---

Restored search totals and facets for public searches. This reverts a 6.7.0 change that broke pagination and facet counts.

In 6.7.0, every public search (`status: 'published'`, the default) through `client.collection(path).search()` and `client.search({ zone })` returned a `total` that counted only the hits on the current page, and dropped the provider's `facets`. A paginator built on `total` therefore showed a single page, and facet panels lost their counts. That change was a breaking API change, and 6.7.0 should not have shipped it as a minor release under an i18n changeset.

Public searches now pass the provider's `total` and `facets` through again. Public locale eligibility is the same for every reader, and indexing already applies it, so the provider's aggregate is the public aggregate.

What stays the same:

- Each public hit is still re-checked for exact-locale eligibility. A stale index entry, such as a translation unchecked since the last reindex, is still dropped from the page. The client now logs a warning that names the collection, document, and locale, so that you can reindex the document.
- Searches with a restriction that depends on the reader keep the restricted-result convention (a page-local `total` and no facets). These are searches over a collection with an active `beforeRead` predicate, and zone searches that exclude member collections the actor can't read.

No migration is required.
