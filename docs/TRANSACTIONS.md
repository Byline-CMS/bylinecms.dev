---
title: "Transactions"
path: "transactions"
summary: "Request-scoped transaction propagation via AsyncLocalStorage — a service-owned withTransaction boundary that lets multiple db commands commit or roll back atomically, without threading a tx handle through every signature. Decision note; not yet built."
---

# Transactions

:::note[Status]
**Decision note — not yet built.** Records the chosen approach to
multi-command atomicity so the seam is designed before the first consumer
(the [audit log, AUDIT.md Workstream 2](./AUDIT.md#workstream-2--document-grain-audit-log-new-table--migration))
lands. Where this note and shipped code disagree, the code wins.
:::

## The problem

Today every `db.commands.*` mutation owns its own transaction internally
(`this.db.transaction(...)` — 6 sites, all in
`packages/db-postgres/src/modules/storage/storage-commands.ts`). Each command
is atomic **in isolation**, but two commands cannot be composed into one
transaction. That's a gap the moment a single logical operation must write
two things atomically:

- **The audit log (the forcing case).** A document-grain change — a path
  edit, a status transition, a delete — and its audit-log row must commit
  together. The one unacceptable outcome for an *auditability* feature is a
  change that succeeds while its audit row silently fails to write. See
  [AUDIT.md](./AUDIT.md).
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
inserts a row. The storage layer never learns the word "audit".

## Boundary placement

`withTransaction` is **owned by the service layer**, not the adapter and not
the transport. The `DocumentLifecycleContext` (or the equivalent per-realm
context) carries the `TXManager`, so a lifecycle service decides what spans a
transaction. Commands stay transaction-agnostic — correct whether called
standalone (their statements run on the pool) or inside a `withTransaction`
(they join the ambient tx).

When `get()` already returns a tx and a command opens its own
`.transaction(...)`, Drizzle issues a **SAVEPOINT** (nested transaction): an
inner failure rolls back to the savepoint, an outer failure rolls back
everything — the correct semantics. The 6 existing transaction sites should
be reviewed for this nesting behaviour as they're converted, but it's
low-risk for the simple update/insert commands the audit work touches.

## Incremental adoption

Not a big-bang rewrite of the adapter:

1. Introduce `DBManager` / `TXManager` (the ~40-line port) and swap the
   adapter's injected `db` for a `DBManager` at the composition point
   (constructor injection today: `constructor(private db: DatabaseConnection)`).
2. Convert only the commands the first consumer needs — for the audit log:
   `setDocumentStatus`, `updateDocumentPath`, `setDocumentAvailableLocales`,
   `softDeleteDocument`, plus the new `audit.append` — to obtain their
   executor via `get()`.
3. Let the rest of the adapter's `this.db.` references migrate
   opportunistically.

**The one caveat:** a command **not yet converted** won't see the ambient
transaction — it silently runs on the pool. So every `withTransaction` block
must only span *converted* commands until the migration is complete. Easy to
honour; worth a deliberate check at each call site.

## DB↔DB vs DB↔external — what this does and does not solve

A sharp line, because conflating the two leads to a wrong design:

- **DB ↔ DB** (audit + mutation; document + related record): **fully solved.**
  Multiple commands, one transaction, atomic.
- **DB ↔ external side-effect** (file storage + media record): **not solved
  by transactions.** You cannot roll back an S3 / filesystem `PUT` inside a
  database transaction. That stays a **compensation / saga** concern — write
  the file, write the DB record in a transaction, and on DB failure delete
  the file (the upload flow already carries partial compensation:
  `shouldCreateDocument: true` "rolls back storage on failure", see
  [FILE-MEDIA-UPLOADS.md](./FILE-MEDIA-UPLOADS.md)). This work makes the *DB
  side* of uploads atomic and tidier; the file↔DB boundary still needs
  compensation. "Transactions fix uploads" is **not** a promise this makes.

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
   [CORE-COMPOSITION.md](./CORE-COMPOSITION.md#architectural-guard-rails).
2. **`withTransaction` is an adapter capability on the contract.** Services
   depend on `IDbAdapter.withTransaction(fn)`, not on Postgres specifically,
   so a future Fastify/serverless adapter has an explicit method to satisfy
   or reject.
3. **Non-support must be loud, never silent.** An adapter that cannot provide
   interactive transactions must **throw** on `withTransaction` (or fail a
   boot-time capability check), *not* degrade to running `fn` without
   atomicity. Audit atomicity is the whole point; silently non-atomic audit
   writes are worse than no feature. A non-transactional adapter is a
   deployment the operator must consciously accept (and audit atomicity
   degrades, documented and guarded).
4. **Emulation is YAGNI.** A command-buffer / outbox that batches statements
   to flush as one HTTP request at "commit" is conceivable for HTTP-batch
   drivers — but it isn't worth designing until a second, genuinely
   serverless adapter actually arrives. Same "design against two concrete
   shapes" discipline used for the stable HTTP transport and the richtext
   adapter contract.

## Code map (planned)

| Concern | Location |
|---|---|
| `DBManager` / `TXManager` (ALS propagation) | `packages/db-postgres/src/` (new — adapter-internal) |
| `withTransaction` on the adapter contract | `packages/core/src/@types/db-types.ts` (new capability) |
| Transaction boundary owner | service layer via `DocumentLifecycleContext` |
| Existing per-command transaction sites | `packages/db-postgres/src/modules/storage/storage-commands.ts` (6) |
| Prior-art ALS usage in-repo | `packages/core/src/lib/logger.ts` (`withLogContext`) |
| First consumer | [AUDIT.md Workstream 2](./AUDIT.md#workstream-2--document-grain-audit-log-new-table--migration) |
