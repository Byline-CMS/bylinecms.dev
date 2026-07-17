---
title: "Transactions"
path: "transactions"
summary: "Request-scoped transaction propagation via AsyncLocalStorage — a service-owned withTransaction boundary that lets multiple db commands commit or roll back atomically, without threading a tx handle through every signature."
---

# Transactions

Byline exposes a request-scoped `withTransaction` capability so that several
database commands can commit or roll back atomically, without threading a
transaction handle through every signature. The boundary is owned by the service
layer; commands resolve their executor through an `AsyncLocalStorage`-propagated
transaction. Its primary consumers are the
[document-level audit log](../06-auth-and-security/02-auditability.md#the-document-level-audit-log),
the locked snapshots used by non-versioned system-field writes, and document
tree mutations. Each audited write-point wraps its mutation and `audit.append`
in one transaction so the change and its audit row commit together.

In the canonical 4.x `IDbAdapter`, this is required rather than optional. The
same intentional breaking contract also requires `commands.audit`,
`queries.audit`, the transaction-scoped
`getDocumentSystemFieldsForUpdate` lock/read, and
`promoteChildrenAndRemoveFromTree` for delete-time tree reconciliation.

## The problem

Before this capability, every `db.commands.*` mutation owned its own
transaction internally (`this.db.transaction(...)` — 6 sites, all in
`packages/db-postgres/src/modules/storage/storage-commands.ts`). Each command
was atomic **in isolation**, but two commands could not be composed into one
transaction. That's a gap the moment a single logical operation must write
two things atomically:

- **The audit log (the forcing case).** A document-level change — a path
  edit, status transition, tree move/promotion, or delete — and its audit-log row must commit
  together. The one unacceptable outcome for an *auditability* feature is a
  change that succeeds while its audit row silently fails to write. See
  [Auditability](../06-auth-and-security/02-auditability.md).
- **Uploads (the half-case — see below).** The media record and its related
  rows should commit together.

## The pattern — AsyncLocalStorage propagation

Ported from the Modulus project (whose `registry.ts` Byline already shares),
and the **same `AsyncLocalStorage` mechanism the logger already uses**
(`packages/core/src/lib/logger.ts` → `withLogContext`). Two small pieces:

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

The win: **commands never thread a `tx` parameter.** They obtain their
executor from `db.get()`; the transaction boundary is owned one level up, by
the service. Compose by wrapping:

```ts
await txManager.withTransaction(async () => {
  await db.commands.documents.setDocumentStatus(...)            // the mutation
  await db.commands.audit.append({ action: 'document.status.changed', ... })
})
// both run on the ambient tx → commit together, or roll back together
```

The audit write lives in the **service** (where the actor and before/after
already are); the adapter only gains a dumb `audit.append` command that
inserts a row. The storage layer never learns the word "audit". See
[the document-level audit log](../06-auth-and-security/02-auditability.md#the-document-level-audit-log)
for the consuming side.

## Boundary placement

`withTransaction` is exposed today as an **adapter capability**
(`IDbAdapter.withTransaction`, wired in `pgAdapter`). Ownership of the
*boundary* — deciding what spans a transaction — belongs to the **service
layer**: each audited lifecycle service wraps its mutation +
`audit.append` in `db.withTransaction(...)`. Commands stay
transaction-agnostic — correct whether called standalone (their statements run
on the pool) or inside a `withTransaction` (they join the ambient tx).

Collection `after*` hooks are deliberately outside this boundary. They run only
after commit and cannot roll back the mutation or its audit row. Most lifecycle
operations still reject when such a hook fails so the caller can reconcile.
Delete is deliberately different: storage cleanup, `afterTreeChange`, and
`afterDelete` are all attempted independently and failures return a committed
result rather than rejecting the already-complete delete. Side-effect consumers
must therefore be idempotent and use the reconciliation paths described for
[system fields](../04-collections/05-document-paths.md#server-transport) and
[document trees](../04-collections/04-document-trees.md#invalidation) where
available.

When `get()` already returns a tx and a command opens its own
`.transaction(...)`, Drizzle issues a **SAVEPOINT** (nested transaction): an
inner failure rolls back to the savepoint, an outer failure rolls back
everything — the correct semantics. The integration test
(`storage-transactions.test.ts`) confirms commit-together and
roll-back-together across nested command transactions.

## Adoption

The capability was added without a big-bang rewrite of the adapter. In place:

1. `DBManager` / `TXManager` (`packages/db-postgres/src/lib/db-manager.ts`),
   constructed in `pgAdapter` and wired to expose `withTransaction`.
2. **Both storage command-builder classes** (`CollectionCommands`,
   `DocumentCommands`) converted in one stroke via a `private get db()` getter
   that resolves `this.dbManager.get()` — so **every** command-builder method,
   not just the four the audit log needs, transparently joins an ambient
   transaction with zero call-site changes.

Still on the raw pool (migrate opportunistically): ordinary
**query-builder** methods, audit reads, and the **counter commands**. One
deliberate query exception exists: `getDocumentSystemFieldsForUpdate` resolves
through the ambient transaction so it can lock the logical document and return
the authoritative path / advertised-locale snapshot used by the write and
audit.

**The one caveat:** an *unconverted* path won't see the ambient transaction —
it silently runs on the pool. A `withTransaction` block must therefore not
assume an arbitrary **query** or **counter** call participates. Only contract
capabilities explicitly documented as transaction-scoped may be relied on
inside the unit of work.

## DB↔DB vs DB↔external — what this does and does not solve

A sharp line, because conflating the two leads to a wrong design:

- **DB ↔ DB** (audit + mutation; system-field snapshot + write; tree
  mutation + audit): **fully solved when composed from transaction-aware
  capabilities.** Multiple participating commands, one transaction, atomic.
  For a tree document delete this includes the soft delete, child promotion,
  edge removal, and every parent/child audit row.
- **DB ↔ external side-effect** (file storage + media record): **not solved
  by transactions.** You cannot roll back an S3 / filesystem `PUT` inside a
  database transaction. That stays a **compensation / saga** concern — write
  the file, write the DB record in a transaction, and on DB failure delete
  the file (the upload flow already carries partial compensation:
  `shouldCreateDocument: true` "rolls back storage on failure", see
  [File / Media Uploads](../04-collections/06-file-media-uploads.md)). This work makes the *DB
  side* of uploads atomic and tidier; the file↔DB boundary still needs
  compensation. "Transactions fix uploads" is **not** a promise this makes.

Document deletion makes that line visible in its return type. The soft delete,
delete audit row, child promotion, edge removal, and tree audit rows either all
commit or all roll back. After commit, storage cleanup and the tree/delete hooks
cannot change that result. `deleteDocument` therefore resolves with either
`{ outcome: 'committed', sideEffectFailures: [] }` or
`{ outcome: 'committed-with-side-effect-failures', sideEffectFailures: [...] }`;
it does not reject for those post-commit failures. Reported failures contain an
allowlisted phase and only `ERR_STORAGE` or `ERR_UNHANDLED`; raw errors and
storage paths are restricted to internal logs. A durable retry queue/outbox for
the reported side effects remains deferred.

## Serverless / HTTP-gateway databases — the contract seam

`AsyncLocalStorage` is **transport-agnostic** — it propagates whatever value
you store, transaction handle or not. The real constraint is one level down:
**interactive transactions require a stateful session** bound to one
connection for the life of the `withTransaction(fn)` callback (open tx → run
arbitrary app code that issues several statements → commit/rollback).

Serverless DB services that expose only a per-request HTTP/API gateway —
**Neon's HTTP driver, Cloudflare D1, PlanetScale's HTTP driver** — generally
**cannot** offer interactive transactions; they accept single queries or
pre-batched arrays, not a callback with app logic interleaved. Drizzle
reflects this: `db.transaction(callback)` exists for session-capable drivers
(node-postgres, postgres.js, Neon **WebSocket**, …) and is absent / throws on
pure-HTTP drivers. (Byline ships exactly one adapter today —
`@byline/db-postgres` on `drizzle-orm/node-postgres` + a real `pg.Pool` —
which is fully interactive-transaction-capable, so the pattern works now with
zero compromise.)

The decisions this forces at the **db contract seam**, made cheaply now so a
future adapter has a clear target:

1. **Transaction machinery lives in the adapter** (`@byline/db-postgres`),
   never in `@byline/core`. Transactions are inherently driver-specific;
   `DBManager` / `TXManager` are adapter internals. Core stays
   transport-agnostic — consistent with guard rail 3 in
   [Core Composition](./02-core-composition.md#architectural-guard-rails).
2. **`withTransaction` is mandatory on `IDbAdapter`.** Services depend on
   `IDbAdapter.withTransaction(fn)`, not on Postgres specifically. A future
   HTTP-only adapter must supply equivalent atomic semantics or cannot implement
   the canonical 4.x interface; pretending that `fn` is transactional is not an
   accepted degradation.
3. **The complete accountability surface is mandatory.** `commands.audit`,
   `queries.audit`, `getDocumentSystemFieldsForUpdate`, and
   `promoteChildrenAndRemoveFromTree` are required alongside
   `withTransaction`. Runtime structural checks remain for untyped JavaScript
   adapters: audited/system-field writes throw `ERR_AUDIT_UNSUPPORTED` when a
   required function is absent, tree audit/delete reconciliation support is
   checked at boot when any collection has `tree: true`, and the system activity
   transport guards a missing audit-query object. These are guards against an
   invalid runtime adapter, not feature negotiation.
4. **Emulation is YAGNI.** A command-buffer / outbox that batches statements
   to flush as one HTTP request at "commit" is conceivable for HTTP-batch
   drivers — but it isn't worth designing until a second, genuinely
   serverless adapter actually arrives. Same "design against two concrete
   shapes" discipline used for the stable HTTP transport and the richtext
   adapter contract.

## Code map

| Concern | Location |
|---|---|
| `DBManager` / `TXManager` (ALS propagation) | `packages/db-postgres/src/lib/db-manager.ts` |
| Canonical transaction/audit/lock/tree contract | `packages/core/src/@types/db-types.ts` (`IDbAdapter`) |
| Command-builder executor getter (`private get db()`) | `packages/db-postgres/src/modules/storage/storage-commands.ts` (`CollectionCommands`, `DocumentCommands`) |
| Transaction-scoped system-field lock/snapshot | `packages/db-postgres/src/modules/storage/storage-queries.ts` (`getDocumentSystemFieldsForUpdate`) |
| Manager construction + `withTransaction` wiring | `packages/db-postgres/src/index.ts` (`pgAdapter`) |
| Atomicity / propagation test | `packages/db-postgres/src/modules/storage/tests/storage-transactions.test.ts` |
| Tree mutation/delete atomicity tests | `packages/db-postgres/src/modules/storage/tests/storage-document-tree-audit.test.ts` |
| Per-command transaction sites (now resolve via the getter) | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| Prior-art ALS usage in-repo | `packages/core/src/lib/logger.ts` (`withLogContext`) |
| First consumer | [the document-level audit log](../06-auth-and-security/02-auditability.md#the-document-level-audit-log) |
