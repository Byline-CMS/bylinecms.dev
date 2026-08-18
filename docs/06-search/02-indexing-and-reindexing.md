---
title: "Indexing and reindexing"
path: "search-indexing"
summary: "How published document versions enter and leave the search index, how lifecycle hooks reconcile changes, and when to rebuild the disposable projection."
---

# Indexing and reindexing

Companions:
- [Configure search](./01-configuration.md) — provider and collection configuration must exist before lifecycle synchronization can write projections.
- [Provider contract](./04-provider-contract.md) — `upsert`, `remove`, and `reindex` are the provider operations used here.
- [Transactions](../03-architecture/03-transactions.md) — search hooks run after the content transaction commits.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — `reindex()` asserts the collection's `reindex` ability.

Byline treats the search index as a published-content projection, not as content storage. This page is for application developers wiring lifecycle hooks and for operators planning migrations, deploys, and rebuilds.

## Published-only synchronization

`CollectionHandle.indexDocument(documentId)` re-reads the document once for each configured content locale with:

```ts
{
  status: 'published',
  onMissingLocale: 'omit',
  _bypassBeforeRead: true,
}
```

For every locale, it performs one of two provider operations:

- `upsert(SearchDocument)` when a published locale view exists;
- `remove({ collectionPath, documentId, locale })` when it does not.

Each locale slice therefore contains genuine published translations only. Byline does not copy a document's source-locale fallback text into every missing locale: doing so would create duplicate projections and run source-language text through the wrong language analyzer. The consequence is deliberate but visible: a document that an ordinary read can render through `source_locale` may still be absent from search in the requested content locale.

The same idempotent path handles a first publish, an edit over an existing publication, an unpublish, a newer draft over an older published version, and a translation becoming available or unavailable. Draft-only content does not enter the built-in index.

Index maintenance bypasses `beforeRead` because the shared index must contain every published candidate. Actor-specific row visibility is applied after ranking when a reader searches.

## Wire collection hooks

Use the system client from server-only hooks. The system client does not depend on request cookies or a TanStack Start request context.

**Edit:** `apps/webapp/byline/collections/<name>/hooks.ts`

```ts
import { getSystemBylineClient } from '@byline/client/server'
import { defineHooks } from '@byline/core'

const search = () => getSystemBylineClient().collection('docs')

export default defineHooks({
  afterCreate: ({ documentId }) => search().indexDocument(documentId),
  afterUpdate: ({ documentId }) => search().indexDocument(documentId),
  afterStatusChange: ({ documentId }) => search().indexDocument(documentId),
  afterUnpublish: ({ documentId }) => search().indexDocument(documentId),
  afterSystemFieldsChange: ({ documentId, requested }) =>
    requested.path ? search().indexDocument(documentId) : undefined,
  afterDelete: ({ documentId }) => search().removeFromIndex(documentId),
})
```

Register this module through the server-only hook registry so its `@byline/client/server` import never enters the browser schema graph.

| Hook | Search action |
|---|---|
| `afterCreate` | Reconcile every published locale |
| `afterUpdate` | Reconcile every published locale |
| `afterStatusChange` | Reconcile publish, archive, or other status changes |
| `afterUnpublish` | Remove locale rows that no longer have a published view |
| `afterSystemFieldsChange` with a path request | Refresh hit paths, including reconciliation retries |
| `afterDelete` | Remove every locale for the document |
| `afterTreeChange` | No search write unless the provider projection includes tree-derived data |

An advertised-locale-only system change does not alter indexed content in the reference application. A path change does, because lightweight search hits carry `path`.

:::warning[Use the system client in lifecycle hooks]
Do not call `getAdminBylineClient()` from a collection lifecycle hook. That client resolves a request-scoped admin session and fails when imports, seeds, migrations, tests, or other background work run without an HTTP request. `getSystemBylineClient()` is the correct authority for published-index maintenance.
:::

## Post-commit failure behavior

Search hooks run after the source database transaction commits. Awaiting `indexDocument()` therefore gives callers a visible failure, but it cannot roll back the content write.

For create, update, status, and system-field operations, a hook failure can reject the lifecycle call after content has committed. The index may remain stale until a later reconciliation or rebuild.

Delete is different. A failed `afterDelete` side effect does not reject the committed database and audit result. The lifecycle returns `committed-with-side-effect-failures`, and the host can warn the editor. Because the source document no longer exists, there is no retry-by-delete path; a rebuild removes any orphaned search row.

The current reference hooks await search and cache effects. A durable outbox, retries, and background indexing remain future work.

## Rebuild a collection

`client.collection(path).reindex()` performs a full collection rebuild:

1. assert `collections.<path>.reindex`;
2. clear the provider's collection slice and analyzer metadata;
3. page through every published document;
4. call `indexDocument()` for each document; and
5. return the number of source documents walked.

```ts
import { getSystemBylineClient } from '@byline/client/server'

const report = await getSystemBylineClient().collection('docs').reindex()

console.log(report)
// { collectionPath: 'docs', documents: 240, indexed: 240 }
```

The `indexed` count currently mirrors source documents walked, not the exact number of locale rows written.

Use a complete rebuild:

- when enabling search for an existing collection;
- after changing `search.body`, weights, facets, filters, or zones;
- after changing analyzer options or language expanders;
- after changing the provider-owned schema;
- after switching providers; or
- to remove orphan rows after a missed delete side effect.

Reindexing is synchronous and uses pages of 100 published documents. This is appropriate for small and medium collections. Large corpora need a background job with progress, throttling, and durable retry.

## Switching providers

Registering a different search provider is a configuration change with index-wide consequences. Each provider owns its physical analysis and storage, so the same published content produces different index data under each provider, and the previous provider's rows are useless to the new one.

To switch:

1. provision the new provider's schema: `migrate(pool)` for the SQL providers, or the engine's own schema artifact for an external engine;
2. register the new provider in `ServerConfig.search`; and
3. rebuild every searchable collection with `client.collection(path).reindex()`.

Until every rebuild completes, queries against the new provider return incomplete results: empty for any collection that has not been rebuilt yet.

:::warning[No dual-write or atomic cutover]
Byline registers exactly one active search provider. There is no mechanism that writes to two providers at once, migrates index rows between providers, or switches atomically. A zero-downtime provider change needs orchestration outside Byline: for example, a second application deployment configured with the new provider, cut over after its rebuild completes.
:::

A provider change can also change the capability report, so application code gated on `provider.capabilities` (matching controls, facets, highlights) may behave differently after the switch. [Native search engines and backend portability](./08-native-engine-providers.md) explains which behavior is guaranteed across providers and which is legitimately provider-specific.

## Add the admin rebuild action

The TanStack Start host exports a permission-gated list action.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```tsx
import { type CollectionAdminConfig, defineAdmin } from '@byline/core'
import { ReindexButton } from '@byline/host-tanstack-start/admin-shell/collections/reindex-button'

import { Docs } from './schema.js'

export const DocsAdmin: CollectionAdminConfig = defineAdmin(Docs, {
  listActions: [ReindexButton],
})
```

`defineAdmin()` takes the collection definition as its first argument so the
admin config is typed against that collection's fields.

The button hides unless the actor has `collections.<path>.reindex`. Its server function asserts the same ability before calling `CollectionHandle.reindex()`.

## Provider migrations

Search providers own independent migration streams:

- PostgreSQL records versions in `byline_search_migrations` and applies each file transactionally.
- MySQL records the same ledger, but MySQL DDL auto-commits. Its migrator uses `GET_LOCK`, idempotent statements, and writes the ledger only after every statement completes.

Search migrations do not belong in the storage adapter's Drizzle migration stream. The packages embed migration text for bundled runtimes and also ship numbered SQL files for DBA-controlled deployment.

Apply migrations before the application serves search traffic:

```ts
import { migrate } from '@byline/search-postgres'

const { applied } = await migrate(db.pool, {
  log: (message) => logger.info(message),
})
```

The index is disposable. When a release changes the initial search schema or analyzer contract, drop only the provider-owned search tables, apply the current schema, and rebuild from published content. Do not copy old physical tokens into a new analyzer.

## Analyzer fingerprint changes

Portable providers store one analyzer fingerprint per collection. They compare query and write analyzers with this metadata before using the index.

If they differ, the provider throws `SEARCH_INDEX_REINDEX_REQUIRED` with the affected collection path. Clear and rebuild that collection using the same provider and analyzer that will serve queries.

Sequence deployment and reindexing so users do not search between installing a new analyzer and completing its rebuild. During that interval, rejecting a query is safer than returning incomplete mixed-analyzer results.
