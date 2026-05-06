---
"@byline/core": minor
"@byline/client": minor
---

- @byline/core — `where`: document-level reserved keys (`status`, `path`) inside a nested relation sub-clause now downshift to `DocumentColumnFilter` entries against the target version's `document_versions` columns — same precedence as the top level, with no field-shadow exception. So `where: { category: { path: 'news' } }` filters by the target's document-level path (slugified from `useAsPath`), matching the consumer-intuitive reading. The Postgres adapter already exposed `td${depth}.status` / `td${depth}.path` via the inner relation scope; lifting the parser restriction is the only change. `query` inside a relation sub-clause is dropped with a `logger.debug` line — text search doesn't compose through a relation hop, mirroring the existing rule for `query` inside a combinator.
- @byline/client — surfaces the change. Existing nested-where examples like `{ category: { path: 'news' } }` keep working but now resolve against the target's `document_versions.path` column (rather than silently no-op'ing). A target collection that previously declared a `path` or `status` field will see those clauses resolve as the document column, not the field; rename the offending field (e.g. to `slug`) if the field-filter behaviour was intentional.
