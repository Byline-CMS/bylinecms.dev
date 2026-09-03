---
title: "Transactions"
path: "transactions"
summary: "What Byline guarantees to write atomically and what it does not, the transaction capability every database adapter must supply, and the AsyncLocalStorage propagation that makes composed writes possible."
---

# Transactions

Companions:
- [Auditability](../07-auth-and-security/02-auditability.md) — the first consumer of this capability; every audited write commits its change and its audit row together.
- [Core Composition](./02-core-composition.md) — where `withTransaction` sits in the adapter contract, and the guard rail that keeps transaction machinery out of `@byline/core`.
- [File / Media Uploads](../04-collections/06-file-media-uploads.md) — the compensation path for the one boundary transactions cannot cover.
- [Document Trees](../04-collections/04-document-trees.md) — tree mutations are the most composed write in the system, and the clearest example of the guarantee.

## Overview

Byline needs several database writes to succeed or fail as a unit. A status change and its audit row must land together; deleting a node in a document tree must promote its children, remove its edge, and record every one of those in the audit log, or do none of it. This document states **what Byline guarantees to write atomically, what it deliberately does not, and what your database adapter must supply** to make the guarantee real.

Read the first section if you consume Byline's API: the boundary it describes is visible in return types you have to handle. Read the rest if you are writing a database adapter.

## What is atomic, and what is not

The distinction that matters is between two writes to the database, and a write to the database paired with a write to something else. Conflating them leads to a wrong design.

### Database to database — guaranteed

Multiple database commands composed inside one `withTransaction` block commit together or roll back together. This covers:

- A mutation and its audit row: a path edit, a status transition, a tree move or promotion, a delete.
- A locked system-field snapshot and the write that depends on it.
- A whole-document soft delete: every version tombstone and every path-row `deleted_at` marker.
- A storage-level whole-document un-delete: every version and path row, including rollback when a
  retained path conflicts with a live document.
- A tree document delete: the version/path soft delete, child promotion, edge removal, and every
  parent and child audit row.

This is fully solved when the participating commands are transaction-aware capabilities. It is the property that makes auditability trustworthy: the unacceptable outcome for an audit feature is a change that succeeds while its audit row silently fails.

### Database to an external side effect — not guaranteed

You cannot roll back an S3 or filesystem `PUT` inside a database transaction. File storage paired
with a new media record is therefore a **compensation** concern, not a transaction one: write the
file, write the database record in a transaction, and on database failure delete only the newly
written source and variants. The upload flow carries that compensation when document creation is
part of the operation.

Soft delete is deliberately different. It performs no external-storage delete: immutable document
versions or duplicated documents may share the same source and variant paths, so one document
cannot prove exclusive ownership. Sources and persisted variants remain retained until a supported
reference-safe purge exists. See
[File / Media Uploads](../04-collections/06-file-media-uploads.md#immutable-media-retention).

Transactions make the *database side* of uploads atomic and tidier. **"Transactions fix uploads" is not a promise this makes.**

### What this means for your code

Collection and singleton `after*` hooks run only after commit. They cannot roll back the mutation or its audit row. Version-creating operations use `ERR_DOCUMENT_HOOK_COMMITTED` when `afterCreate`, `afterUpdate`, or singleton `afterSave` rejects; its allowlisted details include the committed document and version IDs. This covers ordinary saves, duplicate, restore, copy-to-locale, delete-locale, and singleton saves. The admin host treats that code as saved-with-warning, refreshes the canonical state, and never replays the version write.

**Delete is deliberately different, and it is visible in the return type.** `afterTreeChange` and
`afterDelete` are attempted independently, and their failures do not reject an already-committed
delete. `deleteDocument` resolves with one of:

```ts
{ outcome: 'committed', sideEffectFailures: [] }
{ outcome: 'committed-with-side-effect-failures', sideEffectFailures: [...] }
```

If you call `deleteDocument`, handle both. Reported failures carry an allowlisted phase
(`afterTreeChange` or `afterDelete`) and only `ERR_STORAGE` or `ERR_UNHANDLED`; raw errors and any
storage paths from a hook stay in internal logs. Side-effect consumers must be idempotent and use
the reconciliation paths described for
[system fields](../04-collections/05-document-paths.md#server-transport) and
[document trees](../04-collections/04-document-trees.md#invalidation). A durable retry queue or
outbox for reported hooks remains deferred.

## What your adapter must supply

`withTransaction` is **mandatory** on `IDbAdapter` in 4.x, not an optional capability. Services depend on `IDbAdapter.withTransaction(fn)` rather than on Postgres specifically, so a new adapter must provide equivalent atomic semantics. Pretending that `fn` is transactional when it is not is not an accepted degradation.

It arrives alongside the rest of the accountability surface: `commands.audit`, `queries.audit`,
`getDocumentSystemFieldsForUpdate`, and `promoteChildrenAndRemoveFromTree`.
`IDocumentCommands.restoreSoftDeletedDocument` is also required: an adapter must reactivate all
version and path tombstones atomically and let its live-path constraint roll the operation back on
conflict. Both built-in adapters implement the member. An out-of-tree adapter must add it when
upgrading `@byline/core`; there is no optional capability fallback.

Creating a version for an existing document takes a row-scoped document lock before checking
version liveness and the write's `previousVersionId`. Saves to the same document therefore
serialize with each other and with soft-delete/un-delete, while unrelated documents remain
concurrent. A stale parent raises `ERR_CONFLICT` before a version is inserted. Locale-specific
writes to an existing versioned document must supply the current parent because storage copies all
other locales forward from it; omitting the parent also raises `ERR_CONFLICT`. Use one
`locale: 'all'` write to persist a complete multi-locale tree rather than batching per-locale
writes in one transaction. The guard also rejects adding a live version to a fully deleted
document; whole-document un-delete is the supported storage primitive for that transition.

Runtime structural checks back the TypeScript contract for untyped JavaScript adapters: audited
and system-field writes throw `ERR_AUDIT_UNSUPPORTED` when a required function is absent, and tree
support is validated at boot when any collection sets `tree: true`.

### Boundary ownership

The adapter supplies the capability; **the service layer owns the boundary.** Each audited lifecycle service decides what spans a transaction by wrapping its mutation and `audit.append` in `db.withTransaction(...)`. Commands themselves stay transaction-agnostic: correct whether called standalone, where their statements run on the pool, or inside a `withTransaction`, where they join the ambient transaction.

One consequence worth knowing: not every path is transaction-aware. Ordinary query-builder methods, audit reads, and counter commands still run on the raw pool, so a `withTransaction` block must not assume an arbitrary query or counter call participates. Only capabilities documented as transaction-scoped may be relied on inside the unit of work. `getDocumentSystemFieldsForUpdate` is the deliberate exception on the query side: it resolves through the ambient transaction so it can lock the logical document and return the authoritative snapshot the write and its audit row both depend on.

### Serverless and HTTP-gateway databases

Interactive transactions require a **stateful session** bound to one connection for the life of the `withTransaction(fn)` callback: open a transaction, run application code that issues several statements, then commit or roll back.

Serverless database services exposing only a per-request HTTP gateway (Neon's HTTP driver, Cloudflare D1, PlanetScale's HTTP driver) generally cannot offer this. They accept single queries or pre-batched arrays, not a callback with application logic interleaved. Drizzle reflects the split: `db.transaction(callback)` exists for session-capable drivers, including node-postgres, postgres.js, and Neon over WebSocket, and is absent or throws on pure-HTTP drivers.

Byline's built-in `@byline/db-postgres` and `@byline/db-mysql` adapters use stateful pooled
connections and support interactive transactions. A batching command buffer that flushed as one
HTTP request at commit is conceivable for HTTP-batch drivers, but designing it before a genuinely
serverless adapter exists would be speculative. It stays deferred, on the same "design against two
concrete shapes" discipline used for the stable HTTP transport and the rich-text adapter contract.

## How it works

The mechanism is small. `AsyncLocalStorage` carries the open transaction through the async call graph, so commands resolve their executor without anyone threading a handle through every signature. It is the same mechanism the logger already uses (`withLogContext`).

```ts
const transactionALS = new AsyncLocalStorage<DB>()

// Returns the ambient transaction if one is open in this async context,
// otherwise the connection pool.
class DBManagerImpl {
  constructor(private deps: { dbPool: DB }) {}
  get(): DB {
    return transactionALS.getStore() ?? this.deps.dbPool
  }
}

// Opens a real transaction and runs `fn` with that tx bound to the ALS,
// so every `db.get()` *during* `fn` transparently sees the same tx.
class TXManagerImpl {
  constructor(private deps: { db: DBManager }) {}
  withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.deps.db.get().transaction((tx) => transactionALS.run(tx, fn))
  }
}
```

Composing writes is then just wrapping them:

```ts
await txManager.withTransaction(async () => {
  await db.commands.documents.setDocumentStatus(...)            // the mutation
  await db.commands.audit.append({ action: 'document.status.changed', ... })
})
// both run on the ambient tx → commit together, or roll back together
```

The audit write lives in the **service**, where the actor and the before/after values already are. The adapter only gains a `audit.append` command that inserts a row, so the storage layer never learns the word "audit".

Both storage command-builder classes (`CollectionCommands` and `DocumentCommands`) resolve their executor through a `private get db()` getter that calls `dbManager.get()`. Every command-builder method therefore joins an ambient transaction with no call-site changes.

When `get()` already returns a transaction and a command opens its own `.transaction(...)`, Drizzle issues a **savepoint**: an inner failure rolls back to the savepoint, an outer failure rolls back everything. That is the correct nesting semantics, and `storage-transactions.test.ts` confirms both commit-together and roll-back-together across nested command transactions.

## Code map

| Concern | Location |
|---|---|
| `DBManager` / `TXManager` (ALS propagation) | each built-in adapter's `src/lib/db-manager.ts` |
| Canonical transaction/audit/lock/tree contract | `packages/core/src/@types/db-types.ts` (`IDbAdapter`) |
| Command-builder executor getter (`private get db()`) | each adapter's `src/modules/storage/storage-commands.ts` (`CollectionCommands`, `DocumentCommands`) |
| Transaction-scoped system-field lock/snapshot | each adapter's `src/modules/storage/storage-queries.ts` (`getDocumentSystemFieldsForUpdate`) |
| Manager construction + `withTransaction` wiring | `packages/db-postgres/src/index.ts`; `packages/db-mysql/src/index.ts` |
| Delete outcome type | `packages/core/src/services/document-lifecycle/delete.ts` (`DeleteDocumentOutcome`) |
| Atomicity / propagation tests | `packages/db-conformance/src/suites/transactions.ts`; PostgreSQL's focused `src/modules/storage/tests/storage-transactions.test.ts` |
| Path delete/un-delete and tree atomicity tests | `packages/db-conformance/src/suites/document-paths.ts`; `packages/db-conformance/src/suites/document-tree-audit.ts` |
| Prior-art ALS usage in-repo | `packages/core/src/lib/logger.ts` (`withLogContext`) |
