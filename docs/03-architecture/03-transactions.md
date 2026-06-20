---
title: "Transactions"
path: "transactions"
summary: "Request-scoped transaction propagation via AsyncLocalStorage — a service-owned withTransaction boundary that lets multiple db commands commit or roll back atomically, without threading a tx handle through every signature. Foundation shipped in v3.9.0; the first consumer (the audit log) is pending."
---

# Transactions

:::note[Status]
**Foundation shipped in v3.9.0; first consumer live since v3.10.0.** The
request-scoped `withTransaction` capability is live in `@byline/db-postgres` —
`DBManager` / `TXManager` (AsyncLocalStorage propagation), the optional
`IDbAdapter.withTransaction` capability on the core contract, and the storage
command builders converted to resolve their executor through it. Its first
consumer — the
[document-grain audit log](../06-auth-and-security/02-auditability.md#the-document-grain-audit-log) — shipped in
v3.10.0: each audited write-point wraps its mutation + `audit.append` in
`db.withTransaction(...)` so the change and its audit row commit atomically.
Where this note and shipped code disagree, the code wins.
:::

## The problem

Before this capability, every `db.commands.*` mutation owned its own
transaction internally (`this.db.transaction(...)` — 6 sites, all in
`packages/db-postgres/src/modules/storage/storage-commands.ts`). Each command
was atomic **in isolation**, but two commands could not be composed into one
transaction. That's a gap the moment a single logical operation must write
two things atomically:

- **The audit log (the forcing case).** A document-grain change — a path
  edit, a status transition, a delete — and its audit-log row must commit
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
inserts a row. The storage layer never learns the word "audit". (`audit.append`
and the service wiring shipped in v3.10.0 — see
[the document-grain audit log](../06-auth-and-security/02-auditability.md#the-document-grain-audit-log); the
example above shows the consumption shape.)

## Boundary placement

`withTransaction` is exposed today as an **adapter capability**
(`IDbAdapter.withTransaction`, wired in `pgAdapter`). Ownership of the
*boundary* — deciding what spans a transaction — belongs to the **service
layer**: each audited lifecycle service (v3.10.0) wraps its mutation +
`audit.append` in `db.withTransaction(...)`. Commands stay
transaction-agnostic — correct whether called standalone (their statements run
on the pool) or inside a `withTransaction` (they join the ambient tx).

When `get()` already returns a tx and a command opens its own
`.transaction(...)`, Drizzle issues a **SAVEPOINT** (nested transaction): an
inner failure rolls back to the savepoint, an outer failure rolls back
everything — the correct semantics. The integration test
(`storage-transactions.test.ts`) confirms commit-together and
roll-back-together across nested command transactions.

## Adoption — what shipped, what's incremental

Not a big-bang rewrite of the adapter. Shipped in v3.9.0:

1. `DBManager` / `TXManager` (`packages/db-postgres/src/lib/db-manager.ts`),
   constructed in `pgAdapter` and wired to expose `withTransaction`.
2. **Both storage command-builder classes** (`CollectionCommands`,
   `DocumentCommands`) converted in one stroke via a `private get db()` getter
   that resolves `this.dbManager.get()` — so **every** command-builder method,
   not just the four the audit log needs, transparently joins an ambient
   transaction with zero call-site changes.

Still on the raw pool (migrate opportunistically): the **query builders** and
the **counter commands**. Reads don't need to join the audit transaction, and
counters aren't in any audit unit of work.

**The one caveat:** an *unconverted* path won't see the ambient transaction —
it silently runs on the pool. Since the command builders are fully converted,
this now only means a `withTransaction` block should not rely on a **query** or
**counter** call participating. Easy to honour; worth a deliberate check when
those paths are eventually wrapped.

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
  [File / Media Uploads](../04-collections/05-file-media-uploads.md)). This work makes the *DB
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
   [Core Composition](./02-core-composition.md#architectural-guard-rails).
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

## Code map

| Concern | Location |
|---|---|
| `DBManager` / `TXManager` (ALS propagation) | `packages/db-postgres/src/lib/db-manager.ts` |
| `withTransaction` capability (optional) on the contract | `packages/core/src/@types/db-types.ts` (`IDbAdapter.withTransaction?`) |
| Command-builder executor getter (`private get db()`) | `packages/db-postgres/src/modules/storage/storage-commands.ts` (`CollectionCommands`, `DocumentCommands`) |
| Manager construction + `withTransaction` wiring | `packages/db-postgres/src/index.ts` (`pgAdapter`) |
| Atomicity / propagation test | `packages/db-postgres/src/modules/storage/tests/storage-transactions.test.ts` |
| Per-command transaction sites (now resolve via the getter) | `packages/db-postgres/src/modules/storage/storage-commands.ts` (6) |
| Prior-art ALS usage in-repo | `packages/core/src/lib/logger.ts` (`withLogContext`) |
| First consumer (live, v3.10.0) | [the document-grain audit log](../06-auth-and-security/02-auditability.md#the-document-grain-audit-log) |
