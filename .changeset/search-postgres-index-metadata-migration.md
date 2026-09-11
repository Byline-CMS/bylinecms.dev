---
"@byline/search-postgres": patch
---

**`@byline/search-postgres`** added migration `0002_analyzer_fingerprint`, repairing installations whose search schema was left incomplete.

`0001_init.sql` was amended in place in 4.9.0 to add the `analyzer_fingerprint` column, a `NOT NULL` constraint on `search_vector`, and the `byline_search_index_metadata` table. The migration runner records applied *versions*, not content, so any database that had already applied `0001` — that is, one whose first boot ran **3.15.0 through 4.8.0** — never received those three changes. Writing to the index then fails with `relation "byline_search_index_metadata" does not exist`.

`0002` repairs such a database and is a no-op on any database whose `0001` already carried all three; every statement is conditional and re-running it is safe. It applies automatically at boot wherever the host calls `migrate(pool)`.

**If your database is affected, its search index is emptied and must be rebuilt.** Rows written before portable lexical analysis carry no analyzer fingerprint and cannot be matched by any current query, so `0002` deletes them rather than inventing one. Run a reindex per searchable collection (`client.collection(path).reindex()`, or the admin list-view **Reindex** action) immediately after deploying; until you do, search returns no results.

To check a database before upgrading:

```sql
SELECT
  (SELECT max(version) FROM byline_search_migrations)            AS at_version,
  to_regclass('public.byline_search_index_metadata') IS NOT NULL AS has_metadata,
  (SELECT count(*) FROM byline_search_documents)                 AS index_rows;
```

`has_metadata = false` means the installation is affected and will need the reindex above. Installations that select a different `SearchProvider` still apply `0002` at boot — the migration is independent of provider selection — but need no reindex, because only the Postgres index is touched.
