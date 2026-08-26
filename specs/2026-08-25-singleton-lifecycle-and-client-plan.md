# Singleton Lifecycle and Client Implementation Plan

> **For implementers:** Work the tasks in order. Each task is an independent
> red → green → commit cycle with its own tests; do not start a task before its
> predecessor is committed. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a singleton *usable* — readable, saveable, authorized, and reachable through a
typed client handle — reusing the existing document lifecycle rather than duplicating it.

**Architecture:** A singleton's content is an ordinary document. `updateSingleton` is an upsert
from the caller's perspective: it locks the schema registration row, reads the mapping added in
Plan 2, and either updates the mapped document or creates one and inserts the mapping in the
same transaction. Everything downstream — versions, locales, workflow, schedule, history,
restore, populate, upload — is the existing machinery, reached through the mapped document id.

**Tech Stack:** TypeScript, PostgreSQL, MySQL, Vitest, Biome, pnpm/Turborepo.

**Spec:** `specs/2026-08-25-singleton-documents-design.md` — this plan implements **Phase 2**
(“lifecycle, client, and authorization”), plus the kind-aware ability and upload-authorization
work agreed during review.

**Depends on:** `specs/2026-08-25-singleton-schema-and-storage-plan.md` (all eight tasks).
The mapping table, `isSingleton`, and the generated singleton registries must be committed
first.

## Granularity

Every task here spans two or more packages. Following the model set for Plan 2's Tasks 6–8,
each is written as **required behaviour → artifacts → red/green tests → gates**. Call sites are
discovered at implementation time with `rg` and `pnpm typecheck`, which are precise and current
in a way a written line number is not. What is fixed is the behaviour and the gates.

## Global Constraints

- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char line width,
  trailing commas (ES5).
- **Lint scope:** during a task, `pnpm exec biome check --write <paths>` on files you touched.
  Root `pnpm lint` runs once in final verification; inspect its diff before committing.
- **Focused test runs:** pass the filter directly, no `--` separator. Adapter integration
  suites are `*.integration.test.ts` and run only in vitest's integration mode.
- Conventional commits, lowercase after the colon, past tense. Commit with `git commit -s`;
  the DCO `Signed-off-by` trailer is the ONLY permitted trailer.
- Integration tests need both databases: `pnpm db:init:test` and `pnpm db:init:test:mysql`
  once each.
- **Every commit must leave `pnpm typecheck` and `pnpm test` green.** Where a change widens a
  required interface, land the widening and every implementation in the same commit.

---

### Task 1: Define the singleton hook family

**Required behaviour**

1. `SingletonHooks` exists with hooks named for the **public singleton operation**, not the
   internal create/update branch: `beforeSave`, `afterSave`, `beforeRead`, `afterRead`,
   `beforeStatusChange`, `afterStatusChange`, `beforeUnpublish`, `afterUnpublish`.
2. `beforeSave` / `afterSave` fire on **every** save including the first. Their contexts carry
   `isInitialSave: boolean`, `data`, `originalData` (`null` on the initial save), the singleton
   path, locale, and request context. `beforeSave` receives the existing document id or `null`;
   `afterSave` receives the persisted document and version ids.
3. Every singleton write passes through `beforeSave` / `afterSave`, distinguished by a public
   **operation discriminator** on the context. Define it now — Task 4c must not have to invent
   a public hook API:

   ```ts
   export type SingletonSaveOperation =
     | { type: 'save' }
     | { type: 'restore'; sourceVersionId: string }
     | {
         type: 'copyToLocale'
         sourceLocale: string
         targetLocale: string
         overwrite: boolean
       }
   ```

   Per-branch shapes, which must be pinned by tests:

   | Branch | `data` | `originalData` | `locale` |
   |---|---|---|---|
   | `save` | the incoming values | current values, or `null` on the initial save | the locale being written |
   | `restore` | the **complete all-locale tree** reconstructed from `sourceVersionId` | the current all-locale tree (never `null` — restore implies a materialised slot) | `'all'` |
   | `copyToLocale` | the **merged target payload** after applying `overwrite` — not the raw source-locale values | current values **of `targetLocale`**, or `null` when that locale has no content yet | `targetLocale` |

   The `restore` row is not a simplification: `document-lifecycle/restore.ts` reads the source
   version with `locale: 'all'` and persists through `createDocumentVersion` with `locale: 'all'`
   (lines 33, 87, 160), so every locale row moves together. A hook that assumes a single-locale
   `data` shape on the restore branch will misread it. The all-locale field shapes are the
   `...AllLocales` types the codegen emits (Plan 2 Task 8).

   `isInitialSave` is `true` only on the `save` branch's first write. A `restore` can never be
   an initial save; a `copyToLocale` never is either, since the source locale's content must
   already exist.
4. `SingletonDefinition.hooks` becomes `SingletonHooks | SingletonHooksLoader`, replacing the
   `hooks?: never` placeholder from Plan 2 Task 1.
5. `MultiCollectionDefinition.hooks` keeps the existing `CollectionHooks` family unchanged. A
   singleton must not accept `beforeCreate` / `afterUpdate` / `beforeDelete` / tree hooks, and a
   collection must not accept `beforeSave`.
6. Family/discriminant validation happens at **two** points, because it cannot all happen at
   startup. `CollectionHooksLoader` is `() => Promise<...>` (`collection-types.ts:1105`),
   resolved lazily on first lifecycle use via the `resolvedHooksCache` WeakMap (line 1107), and
   `defineServerConfig` / hook attachment are synchronous. A loader's family therefore cannot be
   inspected at startup without eagerly importing every hook module — which would pull
   server-only graphs into the boot path and defeat the loader's purpose.

   **The choice this plan makes:** validate *inline* hook objects at startup (they are present
   and inspectable), and validate *loader-returned* families **on every `resolveHooks(definition)`
   call**, against the definition being resolved. Document the weaker guarantee honestly in the
   JSDoc: a mismatched loader fails on first use of that hook family, not at boot. Do not claim
   startup validation for loaders, and do not eagerly resolve loaders to manufacture it.

   **Validate per call, not per cache fill.** `resolvedHooksCache` is a
   `WeakMap<CollectionHooksLoader, CollectionHooks>` keyed by the *loader function*
   (`collection-types.ts:1107`). If one loader is reused by two definitions — plausible for a
   shared `./shared-hooks.js` module — validating only while populating the cache means the
   second definition hits the cache and skips validation entirely, so a collection could quietly
   inherit a singleton's family or vice versa. Cache the **import**; run the family check against
   the current definition on every resolution.

`afterSave` is the direct home for the cache invalidation a Payload `afterChange` hook performs.
Note in the JSDoc that public-cache invalidation is not automatic: hosts typically invalidate a
preview cache on every save and a public cache only when the published view changes, which is
what the status hooks are for.

**Artifacts**

- `packages/core/src/@types/collection-types.ts` — `SingletonHooks`, its context types,
  `SingletonHooksLoader`, and the `SingletonDefinition.hooks` member
- `packages/core/src/config/attach-hooks.ts` — family/discriminant validation
- `packages/core/src/config/attach-hooks.test.node.ts` — extended

**Red/green**

Failing tests first, in `attach-hooks.test.node.ts`:

- attaching an **inline** `CollectionHooks`-shaped object (`beforeCreate`) to a singleton
  definition throws **at startup**, and the message names both the offending hook and the
  resource kind;
- attaching an inline `beforeSave` to a multi-document collection throws at startup;
- attaching a well-formed inline `SingletonHooks` to a singleton resolves and the hooks are
  reachable on the resolved definition;
- a **loader** returning the wrong family does **not** throw at startup, and **does** throw on
  first resolution — assert both halves, so the weaker guarantee is pinned rather than assumed;
- a well-formed `SingletonHooksLoader` resolves and caches the same way the collection loader
  does (second resolution does not re-import);
- **cross-kind reused loader**: one loader function referenced by both a singleton and a
  collection definition. Resolving it for the kind it matches succeeds; resolving the *same*
  loader for the other kind throws — proving the cache hit did not skip validation. This is the
  case a per-cache-fill check silently passes.

**Gates**

- [ ] `pnpm --filter @byline/core test attach-hooks` green
- [ ] `pnpm typecheck` clean — the `hooks?: never` → `SingletonHooks` swap must not loosen the
      collection side; confirm `beforeCreate` on a singleton is still a compile error
- [ ] The JSDoc states the loader guarantee is first-resolution, not startup
- [ ] `pnpm test` green

---

### Task 2: Widen `beforeRead` to `QueryPredicate | false | void`

**Required behaviour**

1. `BeforeReadHookFn` (`packages/core/src/@types/collection-types.ts:949`) returns
   `QueryPredicate | false | void`.
2. `false` normalises to the **existing** documented always-false predicate,
   `{ id: { $in: [] } }`. Do not invent a new representation: this one is already specified in
   `docs/07-auth-and-security/01-authn-authz.md:559` and already compiles on both adapters,
   deliberately avoiding a sentinel-UUID cast. `false` is sugar for the value people write by
   hand today.
3. It **does not throw** — a collection read returns zero rows and a singleton `get()` returns
   `null`. Hiding a resource is not an authorization error, and turning it into one leaks the
   resource's existence.
4. `void` applies no restriction. A predicate combines with the caller's `where` exactly as
   today.
5. Multiple hooks combine with logical AND, so one `false` cannot be overridden by a later
   hook returning a predicate.
6. `true` is **not** part of the contract — there is no affirmative-allow result.
7. **Both** branches of the return type widen. `BeforeReadHookFn` allows a synchronous value or
   a `Promise`; widening only the synchronous branch makes an `async` hook returning `false` a
   type error.
8. The same contract serves both resource kinds. A singleton has one row, so a row predicate
   adds nothing there, but a single signature keeps the shared machinery shared.

This is what makes the private-singleton recipe work: an operational singleton holding email
routing denies anonymous readers with `return false` rather than constructing a
never-matching predicate.

**Artifacts**

- `packages/core/src/@types/collection-types.ts` — the return type
- `packages/core/src/auth/apply-before-read.ts` — normalisation and AND-combination
- `packages/core/src/query/parse-where.ts` — **no change expected.** `{ id: { $in: [] } }`
  already compiles correctly. If a change proves necessary here, that is a signal the
  normalisation in `apply-before-read.ts` is producing something other than the documented
  predicate — fix the normalisation, not the parser.
- `docs/07-auth-and-security/01-authn-authz.md` — the Quick Reference gains a `false` recipe
  (documentation lands in Plan 5; leave a note, do not write it here)

**Red/green**

Unit tests in `apply-before-read.test.node.ts` (or alongside it):

- a hook returning `false` yields exactly `{ id: { $in: [] } }`;
- an `async` hook returning `false` behaves identically (pins the Promise branch);
- `false` AND a permissive predicate is still always-false, in either hook order;
- `void` alone applies no restriction;
- the existing predicate-combination behaviour is unchanged (regression).

Integration coverage, in the client suite: a collection whose `beforeRead` returns `false` for
an anonymous reader returns an empty result set rather than throwing, and the same collection
read by an authenticated actor returns rows.

**Gates**

- [ ] `pnpm --filter @byline/core test` green
- [ ] `pnpm test:integration` green — the always-false predicate must compile on **both**
      adapters; a predicate that works on Postgres and not MySQL fails here
- [ ] `rg "beforeRead"` shows no call site assuming a `QueryPredicate | void` return
- [ ] Existing `beforeRead` recipes still behave identically

---

### Task 3: Centralize kind-aware ability keys and register singleton abilities

**Required behaviour**

1. Each singleton contributes exactly four abilities:
   `singletons.<path>.read`, `.update`, `.publish`, `.changeStatus`.
   There is **no** `create`, `delete`, or `reindex` ability — those operations do not exist on
   a singleton.
2. Initial materialisation requires `update`. The internal create must never assert a public
   `create` ability: from the API's perspective the operation is always "update this named
   slot", including the first time.
3. Ability labels use the singleton's `label`. `registerCollectionAbilities` currently
   interpolates `plural` (`register-collection-abilities.ts:80-90`), which a singleton does not
   have.
4. **Verbs are type-correlated with the kind.** A singleton descriptor must not accept
   `create`, `delete`, or `reindex` — those verbs stay valid for collections, so a single flat
   `AbilityVerb` union is not enough. Model the descriptor so the verb parameter narrows with
   the kind (a discriminated descriptor with a per-kind verb union). Add a compile-time
   negative test (`@ts-expect-error` directly above the offending argument) **and** a runtime
   rejection, since untyped JavaScript callers reach this too.
5. **Key construction is centralized.** `collectionAbilityKey(path, verb)` hard-codes the
   `collections.` prefix. Callers must pass a resource descriptor — the definition, or a
   `{ kind, path }` pair — and let one helper produce `collections.<path>.<verb>` or
   `singletons.<path>.<verb>`. Lifecycle and service code must not reconstruct namespace keys
   from a bare path string.
6. `assertActorCanPerform` accepts the descriptor and keeps its existing policy otherwise:
   no context → `ERR_UNAUTHENTICATED`; `actor: null` permitted only on `read` with
   `readMode === 'published'`; otherwise `actor.assertAbility(<key>)`.
7. History reads use `read` until Byline specifies a separate history ability uniformly for
   all document kinds.

**Artifacts**

- `packages/core/src/auth/register-collection-abilities.ts` — singleton verb set, kind-aware
  key construction, label narrowing
- `packages/core/src/auth/assert-actor-can-perform.ts` — descriptor-taking signature
- Every call site — found with `rg "assertActorCanPerform|collectionAbilityKey"`, not from a
  list in this plan. Expect them across `document-lifecycle/*`, `field-upload.ts`,
  `@byline/client`, and the host adapter's server fns.

**Red/green**

- a singleton definition registers exactly the four abilities, and registering `create`,
  `delete`, or `reindex` for it is absent from the registry;
- a collection definition still registers all seven (regression);
- the contract test that enumerates `COLLECTION_ABILITY_VERBS` is extended with a singleton
  counterpart so a new verb cannot be added to one kind and silently missed on the other;
- `assertActorCanPerform` with a singleton descriptor asserts `singletons.<path>.update`, and
  an actor holding only `collections.<path>.update` is rejected — the namespaces must not
  bleed;
- a singleton descriptor with verb `create` is a **compile** error, and the same call from
  untyped JavaScript is a **runtime** rejection naming the verb and the kind;
- anonymous `read` with `readMode: 'published'` is permitted for a singleton, and anonymous
  `update` is not.

**Gates**

- [ ] `pnpm --filter @byline/core test` green
- [ ] `pnpm typecheck` clean — the descriptor change is a signature change; every call site
      must be updated in this commit
- [ ] No hand-built ability key survives outside the central helper. `rg 'collections\.'` is
      useless here — it matches 136 files of legitimate expressions like
      `db.commands.collections.create` and `this.collections.find`. Search for **quoted or
      interpolated ability keys ending in a known verb** instead:

      ```bash
      rg "['\"\`](collections|singletons)\.[^'\"\`]*\.(read|create|update|delete|publish|changeStatus|reindex)['\"\`]" packages --type ts
      ```

      Every hit must be the central helper, a test asserting a literal key, a seed/fixture
      granting one, or documentation
- [ ] `pnpm test` green

---

### Task 4: Add the singleton persistence and read services

This is the largest task in the plan, because three seams the design assumed already exist do
not. Read this section fully before starting.

**Prerequisite seams that must be built first**

1. **A transaction-scoped registration-row lock on `IDbAdapter`.** Plan 2 added only
   `setMapping` and `getMappedDocumentId`. The upsert flow below locks the *schema registration
   row* as the slot's mutex, and there is no capability for it. Add one (e.g.
   `commands.singletons.lockSlot(collectionId)`) implemented as **`SELECT … FOR UPDATE` on the
   `byline_collections` row** — a row lock held for the life of the enclosing transaction, and
   released by commit or rollback.

   The justification is **portability and reuse of an existing row**, not lock lifetime.
   PostgreSQL does offer transaction-scoped advisory locks (`pg_advisory_xact_lock`) with
   exactly the right lifetime; the problem is that there is no portable equivalent — MySQL's
   `GET_LOCK` is *session*-scoped, survives rollback, and needs explicit release, and
   PostgreSQL's *session*-level `pg_advisory_lock` has the same shape. `SELECT … FOR UPDATE` on
   a row that already exists for every registered schema behaves identically on both engines,
   needs no new lock-key namespace, and cannot leak a held lock past the transaction on either.
   Do not substitute an advisory lock on one adapter and a row lock on the other. Implement it in both
   adapters through `DBManager` so it joins the ambient transaction, and update every explicitly
   `IDbAdapter`-annotated fixture — the same fallout as Plan 2 Task 6, found with
   `rg -l "IDbAdapter" --glob "*.test*.ts" packages` and `pnpm typecheck`. Land the widening and
   both implementations in one commit.

2. **The smallest possible hook-free persistence primitives — plural, if that is what the
   sequencing requires.** The public services cannot be called unchanged: `createDocument`
   asserts `create` (`document-lifecycle/create.ts:77`) and fires `beforeCreate`/`afterCreate`
   (line 95); `updateDocument` asserts `update` and fires `beforeUpdate`/`afterUpdate`
   (`update.ts:81,99,164`). A singleton has no `create` ability and none of those hooks.

   **Extract narrowly.** An earlier draft of this plan claimed the core should absorb "version
   minting, field flattening, numeric normalisation, counters, locale merge, upload wiring".
   That is wrong in two ways and dangerous in a third:

   - **Field flattening already belongs to the adapter** — it happens inside
     `db.commands.documents.createDocumentVersion`, not in these services.
   - **Upload wiring is not in `createDocument` / `updateDocument` at all.**
   - **Normalisation and counter allocation are hook-sequenced.** The documented flows
     (`create.ts:40-50`, `update.ts:48-54`) normalise dates and numerics, fire the before-hook,
     then normalise numerics **again**, and `create.ts` allocates counter values *after*
     `beforeCreate` specifically so user-land hooks can influence them. Hoisting any of that
     into a single core function silently reorders it.

   So: extract only the hook-free steps, and keep every ordering-sensitive step in the wrapper
   where its position relative to the hooks is visible. Preserve exactly, in their existing
   order: normalisation-before-hook, normalisation-after-hook, counter allocation, `path`
   resolution, order-key and tree behaviour, rich-text embedding, and schedule suspension.

   **Do not add a public `skipAuth` / `skipHooks` flag** to the existing services: a bypass
   reachable from outside is a security regression, and the collection path's behaviour must not
   change at all.

3. **The read pipeline lives in `@byline/client`, and Task 6 owns it.** `readSingleton` cannot
   "delegate to the existing document read path" — `packages/core/src/services/document-read.ts`
   exports only `applyAfterRead`, and the complete pipeline (authorization, `beforeRead`,
   status/locale resolution, fetching, populate, rich-text handling, redaction, `afterRead`,
   shaping) is private inside `CollectionHandle.findById`.

   **Decided:** extract that pipeline into a shared primitive in `@byline/client`, and give it a
   pluggable document-id resolver. `CollectionHandle.findById` supplies the id directly;
   `SingletonHandle.get()` supplies a mapping-backed resolver. The primitive owns everything
   else. There is **no** `singleton-lifecycle/read` service in core — do not build one.
   Re-implementing any part of the pipeline for singletons is the wrong answer: a singleton that
   silently skips redaction or `beforeRead` is precisely the failure the private-singleton
   recipe must not have.

**Required behaviour — `updateSingleton`**

An upsert from the caller's perspective:

1. Assert the singleton's `update` ability (Task 3's descriptor form).
2. Open an adapter transaction.
3. **Lock the schema registration row.** Locking the registration row — not the mapping row —
   is what makes the lock work when no mapping exists yet, which is exactly the concurrent
   first-save case.
4. Read `byline_singleton_documents` by `collection_id`, and read the current version if mapped.
5. **`expectedVersionId`**, when supplied, is compared against the current version **while
   holding the lock**. A stale value rejects with a conflict error before any write. Three cases
   must be specified and tested: matches current (proceeds), stale (rejects), and supplied while
   the slot is unmaterialised (rejects — the caller believes it is editing something that does
   not exist).
6. Fire `beforeSave` **inside the transaction**, after the lock and the current-data read, so
   the hook sees consistent state and can mutate `data`.
7. If a mapping exists, take the update path against that document id. Otherwise take the
   create path and insert the mapping in the same transaction. A lost first-save race is the
   `setMapping` primary-key violation: PostgreSQL reports `byline_singleton_documents_pkey` and
   MySQL reports `PRIMARY`. Detect it by `code === DB_UNIQUE_VIOLATION`, never by one engine's
   constraint name.
8. Commit the content version and the mapping together.
9. Fire `afterSave` **after the outer transaction commits**, matching collection after-hook
   semantics. An `afterSave` failure rejects the call while leaving the committed save intact —
   the save happened; the notification did not.
10. **Soft deletion does not release a singleton slot.** The supported singleton API has no
    delete operation, so a mapped soft-deleted document is an exceptional state created only by
    internal tooling or direct adapter use. Reads follow ordinary document liveness and return
    `null`; `updateSingleton` must reject with `ERR_CONFLICT` rather than create a second document
    or append a version to the tombstone. Tooling that intends to rematerialise the slot must
    deliberately call `clearMapping` first.

**Required behaviour — restore**

`restoreVersion` on a singleton has no owner today: `document-lifecycle/restore.ts` asserts
`update` and fires `beforeUpdate`/`afterUpdate` with a `restore` discriminator (lines 65, 68).
Build the singleton restore wrapper **here**, on the same shared persistence core, firing
`beforeSave`/`afterSave` with the operation discriminator the design specifies. Task 7 verifies
it; it must not be the first place it is written.

**Required behaviour — `copyToLocale`**

**Decided: supported in this release.** `copyToLocale` copies content between locales of the
*same* document, so it stays inside the mapped document, reuses the `update` ability, and
introduces no cardinality question. The design promises locale copy/merge, and deferring it
would ship a documented compatibility hole for no benefit.

Build the singleton wrapper here, on the same shared persistence core, firing
`beforeSave`/`afterSave`. Task 6 exposes it on `SingletonHandle`; Task 7 covers it.

**Other invariants**

- The internal create path must **not** assert a public `create` ability.
- `deleteSingleton` and a public `createSingleton` do not exist. `duplicate` is unavailable.
- Two concurrent first saves produce **one** logical document, with no orphaned second document.
- The singleton document retains an internal generated `path` because document storage expects
  path metadata. It is not an identity, is not editable, and is omitted from the client envelope.
- **A first save in a non-default content locale rejects** — the design anchors `path`
  derivation to the default locale — and must reject **before** creating either a document or a
  mapping.

**Artifacts**

- `packages/core/src/@types/db-types.ts` + both adapters — the lock capability
- The extracted hook-free persistence primitives, and the collection wrappers refactored onto
  them with their ordering-sensitive steps left in place
- `packages/core/src/services/singleton-lifecycle/` — `update`, `restore`, `copy-to-locale`.
  **No `read`** — reads are the client-owned primitive built in Task 6.
- Reuse of `DocumentLifecycleContext` (`document-lifecycle/context.ts`) — it already carries
  `db`, `definition`, `collectionId`, `collectionVersion`, `collectionPath`, `storage`,
  `logger`, and the default content locale, and needs no singleton-specific fork

**Red/green**

Unit tests (fake adapter):

- initial materialisation creates a document, inserts the mapping, and fires `beforeSave` /
  `afterSave` with `isInitialSave: true` and `originalData: null`;
- a second save takes the update path, mints a new version, and fires the pair with
  `isInitialSave: false`;
- the internal create asserts no `create` ability;
- `beforeSave` mutations to `data` are persisted;
- an `afterSave` that throws rejects the call, and the version is still committed
  (**necessary but not sufficient — see the integration test below**);
- the mapping-backed id resolver returns `null` before the first save (the read itself is
  Task 6's);
- `updateSingleton` without the `update` ability rejects before any DB work;
- `expectedVersionId`: current proceeds, stale rejects, unmaterialised-with-expected rejects;
- a first save in a non-default locale rejects, and neither a document nor a mapping exists
  afterwards;
- a mapped soft-deleted document remains mapped, reads as `null`, and rejects an update with
  `ERR_CONFLICT` without creating a replacement document;
- **collection regression**: `createDocument` / `updateDocument` / `restoreVersion` still assert
  the same abilities and fire the same hooks in the same order after the persistence-core
  extraction. This is the gate that proves the refactor was behaviour-preserving.

Integration tests (both adapters):

- **concurrent first saves** — drive this **deterministically**, not by repetition. Open two
  transactions and use a barrier: transaction A takes the lock and pauses; transaction B
  attempts its first save and must block; release A; assert exactly one document and one
  mapping, and that B took the update path. A probabilistic loop can pass against a serialised
  pool with no lock at all;
- **locale updates** — saving a second content locale updates the same logical document;
- **published-behind-draft reads** — a draft over a published version still reads published
  content under `status: 'published'`;
- **`afterSave` runs after commit** — this cannot be proven with a fake adapter. A fake that
  persists immediately passes even when `afterSave` still runs *inside* the real transaction, so
  the unit test above is necessary and not sufficient. On **both** adapters: have `afterSave`
  read the mapping and the new version through a separate connection, assert both are visible
  (proving the outer transaction already committed), then throw. Assert the `updateSingleton`
  call rejects **and** that the saved version is still readable afterwards. If `afterSave` ran
  inside the transaction, either the read finds nothing or the throw rolls the save back — both
  fail this test;
- **`copyToLocale`** — copying between two locales of the singleton mints a version on the same
  logical document and creates no second mapping;
- **discriminator coverage (4c)** — one assertion per branch that the context matches the table
  above: `save` carries `{ type: 'save' }` with single-locale `data`; `restore` carries
  `{ type: 'restore', sourceVersionId }` with `locale: 'all'` and all-locale `data` *and*
  `originalData`; `copyToLocale` carries
  `{ type: 'copyToLocale', sourceLocale, targetLocale, overwrite }` with `data` equal to the
  **merged** target payload and `originalData` equal to the target locale's prior values (or
  `null`). Assert `overwrite: true` and `overwrite: false` produce different `data`, or the
  merge is untested;
- invalid operations reject: no delete, no duplicate, no second document.

**Commit boundaries — this task lands as three commits, not one**

The plan's one-task/one-commit rule would otherwise make a large refactor of the most-used
write path in the system land atomically. Split it:

- [ ] **4a — adapter lock seam.** The `lockSlot` capability, both adapter implementations, every
      `IDbAdapter` fixture. Ships green on its own with nothing calling it yet.
      `feat(core): added the singleton slot lock to the adapter seam`
- [ ] **4b — persistence primitives extraction.** Pure refactor: extract the hook-free
      primitives, move the collection services onto them, change **no** behaviour and **no**
      step ordering. The collection regression tests are this commit's gate, and it is
      reviewable in isolation precisely because nothing singleton-specific is in it.
      `refactor(core): extracted hook-free document persistence primitives`
- [ ] **4c — singleton services.** `updateSingleton`, restore, and `copyToLocale` wrappers on
      that core, with their hooks and authorization.
      `feat(core): added the singleton update, restore, and copy-to-locale services`

**Gates**

- [ ] Each of 4a / 4b / 4c leaves `pnpm typecheck` and `pnpm test` green on its own
- [ ] 4b changes no collection behaviour — the regression tests pass **before and after** it
      with no edits to their assertions
- [ ] 4b preserves step order: a test asserts normalisation runs both before and after the
      before-hook, and that counter allocation still happens after `beforeCreate`
- [ ] Unit suite green, including the collection regression tests
- [ ] `pnpm test:integration` green on both adapters
- [ ] Removing the registration-row lock makes the barrier test fail **deterministically** —
      verify once by deleting the lock
- [ ] A rolled-back transaction leaves neither document nor mapping
- [ ] `rg "skipAuth|skipHooks|bypassAuth" packages` returns nothing — the persistence core is
      internal, not a public bypass

---

### Task 5: Make upload authorization kind-aware

**Required behaviour**

1. `field-upload.ts` currently asserts the collection `create` ability unconditionally
   (around line 285), with a comment explaining it as an anti-abuse measure — the point is that
   an anonymous caller must not be able to push bytes into storage. That intent is preserved;
   the key is not.
2. For a **singleton**, an in-form upload asserts `singletons.<path>.update` via the Task 3
   descriptor. A singleton has no `create` ability, so leaving the current assertion in place
   makes every upload fail — including the default hero/OG image, which is the most common
   singleton field.
3. The standalone **"upload and create a document"** branch (`shouldCreateDocument`) is
   prohibited for singletons and must reject with a clear message. Cardinality is owned by
   `updateSingleton`, and an upload path that creates documents would bypass it entirely.
4. **The rejection happens before any bytes are written.** The auth assertion sits early
   (`field-upload.ts:287`), but `shouldCreateDocument` is not consumed until line ~507 — after
   the `beforeStore` chain (line ~357), after `storage.upload`, and after variant generation.
   Rejecting there leaves orphaned objects in storage for an operation that was never legal.
   Put the singleton guard adjacent to the ability assertion, at the top.
5. Field-only storage followed by a singleton save continues to work — that is the normal flow.
6. Collection behaviour is unchanged.

**Artifacts**

- `packages/core/src/services/field-upload.ts`
- Its tests

**Red/green**

- an upload against a singleton with only `singletons.<path>.update` succeeds;
- an upload against a singleton by an anonymous caller rejects (the anti-abuse property that
  motivated the original assertion);
- `shouldCreateDocument: true` against a singleton rejects with a message naming the singleton
  and pointing at `updateSingleton`, **and** the test asserts that `beforeStore`,
  `storage.upload`, and variant generation were **not** called — spy on all three; a rejection
  that happens after the bytes land is not a rejection;
- an upload against a collection still requires `collections.<path>.create` (regression).

**Gates**

- [ ] `pnpm --filter @byline/core test field-upload` green
- [ ] `pnpm test` green
- [ ] `rg "shouldCreateDocument"` shows the singleton guard on every branch that can create
- [ ] The guard sits above the `beforeStore` chain in source order, not below it
- [ ] Storage is empty after a rejected singleton `shouldCreateDocument` call

---

### Task 6: Add the typed `SingletonHandle` to `@byline/client`

**Required behaviour**

1. `client.singleton(path)` returns a `SingletonHandle` with a deliberately narrow surface:

   ```ts
   const settings = await client.singleton('site-settings').get({
     locale: 'th',
     status: 'published',
     populate: { heroImage: ['title', 'image'] },
   })

   await client.singleton('site-settings').update(next, {
     locale: 'th',
     expectedVersionId: settings?.versionId,
   })
   ```

2. `get()` returns `SingletonDocument<TFields> | null`. `null` means any of: the slot has never
   been saved, no version matches the requested read mode, the requested locale is omitted under
   the chosen missing-locale policy, or `beforeRead` returned `false`. The envelope carries the
   logical document id, version id, status, fields, locale metadata, and timestamps — and
   **not** a document `path`.
3. The handle's **complete public surface**, all document-ID-free. Enumerated here so Task 6
   does not have to infer it:

   Every name and option type below mirrors `CollectionHandle` exactly, minus the `documentId`
   first parameter. Do not coin parallel names or new result types where an existing one fits —
   a singleton is the same document reached a different way.

   ```ts
   interface SingletonHandle<TFields> {
     get(options?: GetSingletonOptions): Promise<SingletonDocument<TFields> | null>
     update(data: TFields, options?: UpdateSingletonOptions): Promise<SingletonSaveResult>

     changeStatus(nextStatus: string): Promise<ChangeStatusResult>
     unpublish(): Promise<UnpublishResult>

     schedulePublish(options: SchedulePublishOptions): Promise<DocumentPublishScheduleInfo>
     confirmScheduledPublish(
       options: ConfirmScheduledPublishOptions
     ): Promise<DocumentPublishScheduleInfo>
     cancelScheduledPublish(): Promise<DocumentPublishScheduleInfo | null>
     getScheduledPublish(): Promise<DocumentPublishScheduleInfo | null>

     history<F = TFields>(options?: HistoryOptions): Promise<FindResult<F>>
     findByVersion<F = TFields>(
       versionId: string,
       options?: FindByVersionOptions<F>
     ): Promise<ClientDocument<F> | null>
     restoreVersion(sourceVersionId: string): Promise<SingletonSaveResult>

     copyToLocale(args: {
       sourceLocale: string
       targetLocale: string
       overwrite?: boolean
     }): Promise<SingletonSaveResult>
   }
   ```

   Twelve methods. Notes on the ones an earlier draft got wrong:

   - The schedule surface is **four** methods, not two — `getScheduledPublish` and
     `confirmScheduledPublish` are part of the contract (`collection-handle.ts:631-664`).
     `confirmScheduledPublish` re-authorises a content-edited schedule against the reviewed
     version, which a singleton needs exactly as much as a collection does.
   - The names are `schedulePublish` / `cancelScheduledPublish`, not `schedulePublication` /
     `cancelScheduledPublication`.
   - `SchedulePublicationInput` is the **admin form** type and is not the client contract. Use
     `SchedulePublishOptions`, `ConfirmScheduledPublishOptions`, and
     `DocumentPublishScheduleInfo`.
   - `history` returns the paginated `FindResult<F>` (`collection-handle.ts:756-759`). Do not
     introduce a `SingletonVersionSummary[]`; a singleton accumulates versions indefinitely and
     needs paging as much as any document.
   - `findByVersion` takes `FindByVersionOptions<F>` and returns `ClientDocument<F> | null`.

4. **Authorization runs before the mapping resolver.** Every method asserts its ability
   (Task 3's descriptor form) *first*, then resolves the mapping. Resolving first would let an
   unauthorized caller distinguish a materialised slot from an unmaterialised one by timing or
   error shape — a small existence oracle, and an avoidable one.

5. **Pre-materialisation behaviour is split by kind, and must not be uniform:**

   | Method | Slot never saved |
   |---|---|
   | `get` | `null` |
   | `history` | an empty `FindResult` — `{ docs: [], meta }` echoing the requested `page` / `pageSize`, **not** a bare `[]` |
   | `findByVersion` | `null` |
   | `update` | **succeeds** — this is the materialising call |
   | `changeStatus`, `unpublish` | `ERR_NOT_FOUND` |
   | `getScheduledPublish` | `null` |
   | `schedulePublish`, `confirmScheduledPublish`, `cancelScheduledPublish` | `ERR_NOT_FOUND` |
   | `restoreVersion` | `ERR_NOT_FOUND` |
   | `copyToLocale` | `ERR_NOT_FOUND` |

   Reads return empty rather than throwing, because "not configured yet" is a normal state a
   front end must render. Note `history` returns the paginated `FindResult` envelope in every
   case — an unmaterialised slot yields `{ docs: [], meta }`, never a bare array, or the return
   type is inconsistent with the signature two sections above. Mutations other than `update` throw `ERR_NOT_FOUND`
   (`packages/core/src/lib/errors.ts:181`) because they operate on a version that does not
   exist. A stale `expectedVersionId` is `ERR_CONFLICT` (line 182), not `ERR_NOT_FOUND`.
6. It does **not** expose: `find`, `findOne`, `findById`, `findByPath`, `create`, `delete`,
   `duplicate`, `count`, list, order, tree, `search`, or `reindex`.
7. `client.collection(path)` rejects a singleton path at runtime, and `client.singleton(path)`
   rejects a collection path. With generated types present, both are compile-time errors too.
8. `RegisteredSingletons` is added to `packages/client/src/register.ts`, mirroring
   `RegisteredCollections` (line 35) — a conditional `infer` fallback, **not** a new optional
   member on the empty `Register` interface. Plan 2 Task 8 already emits the `singletons`
   augmentation; this is the consuming half.
9. **`RegisteredSingletons` alone is not sufficient.** `BylineClient` currently carries a single
   registry generic — `class BylineClient<TRegistry extends CollectionRegistry =
   RegisteredCollections>` (`packages/client/src/client.ts:68`), with `createBylineClient`
   matching at line 216.

   **Decided:** a **second defaulted generic**, not a composite registry:

   ```ts
   class BylineClient<
     TCollections extends CollectionRegistry = RegisteredCollections,
     TSingletons extends CollectionRegistry = RegisteredSingletons,
   >
   ```

   A composite parameter would change the meaning of every existing call site that passes the
   first generic explicitly; a second defaulted one leaves them all intact. Apply the same shape
   to `createBylineClient` (line 216). Both defaults must preserve the loose fallback so
   unaugmented consumers — downstream apps mid-migration, scripts compiled outside the app
   program, this package's own tests — keep compiling unchanged. That fallback is why the
   conditional-`infer` shape exists in the first place.
10. **`copyToLocale` is exposed** on `SingletonHandle`, backed by the wrapper Task 4 builds.

**Artifacts**

- `packages/client/src/singleton-handle.ts`
- `packages/client/src/register.ts` — `RegisteredSingletons`
- The `BylineClient` entry point — `singleton(path)`
- `packages/client/DESIGN.md` — a phase note

**Red/green**

- `get()` on an unmaterialised slot returns `null`, not a throw;
- `get()` after a save returns the envelope, and the envelope has no `path` member;
- `update()` resolves the document id internally — the caller never threads one;
- `client.collection('<singleton-path>')` throws, and `client.singleton('<collection-path>')`
  throws, each with a message naming the actual kind;
- with generated types present, both mistakes are compile errors — assert with
  `@ts-expect-error` directly above the offending argument;
- `beforeRead` returning `false` surfaces as `null` from `get()`, not an exception;
- every pre-materialisation row in the table above is asserted — reads empty, `update`
  materialises, every other mutation `ERR_NOT_FOUND`;
- an unauthorized caller gets the ability error for **both** a materialised and an
  unmaterialised slot, with no difference in error shape (the existence-oracle check).

**Gates**

- [ ] `pnpm --filter @byline/client test` green
- [ ] `pnpm test:integration` green
- [ ] `rg "singleton" packages/client/src` shows no `find`/`create`/`delete` reaching the handle
- [ ] The `Register` base interface is still `export interface Register {}` — unchanged
- [ ] An unaugmented consumer (no generated types) still constructs a `BylineClient` with no
      type arguments and compiles — assert with a fixture that does not import generated types
- [ ] `pnpm --filter @byline/client typecheck` clean with and without the augmentation present

---

### Task 7: Verify inherited behaviour through the shared lifecycle

The spec's claim is that workflow, schedule, history, restore, locale, populate, and upload all
work on a singleton because a singleton's content is an ordinary document. This task **proves**
it rather than assuming it, and is the difference between a feature that works and one that
works in the two paths someone happened to try.

**Required behaviour**

No new production code is expected — **and that is now true**, because Task 4 builds the
singleton restore wrapper and Task 4/6 settle `copyToLocale`. An earlier draft of this plan
expected restore to work here with no owner anywhere, which would have made this task the place
it got written under time pressure.

If a test here fails, the fix belongs in whichever earlier task owns that seam — not in a
singleton-specific special case. A special case appearing in this
task is a signal that the shared-lifecycle claim is wrong somewhere and should be raised rather
than patched.

**Coverage**

Integration tests against both adapters:

- **workflow** — a singleton on `SINGLE_STATUS_WORKFLOW` saves straight to published and
  exposes no transitions; a singleton on the default workflow drafts, publishes, and unpublishes;
- **schedule** — a scheduled publication on a singleton fires and passes through the status
  hooks;
- **history** — versions accumulate and are listable;
- **restore** — restoring a historical version mints a new version and passes through
  `beforeSave` / `afterSave` with the operation discriminator;
- **locale** — per-locale content resolves, `onMissingLocale` behaves as it does for a
  collection, and `copyToLocale` copies content between two locales of the singleton, minting a
  version and firing `beforeSave`/`afterSave`;
- **populate** — a relation from a singleton to a collection populates, and the depth /
  cycle guards behave normally;
- **upload** — a file field on a singleton stores, generates variants, and is retrievable
  after the first save.

**Gates**

- [ ] Every bullet above has at least one passing integration test on **both** adapters
- [ ] No singleton-specific branch was added to `document-lifecycle/` to make them pass
- [ ] `pnpm test && pnpm test:integration` green

---

## Out of scope for this plan

- `SingletonAdminConfig`, `defineSingletonAdmin`, `SingletonView`, routes, dashboard cards
  (Plan 4).
- Documentation, the auth Quick Reference `false` recipe, and the Payload migration example
  (Plan 5).
- Making a singleton a relation target — a non-goal of this release; Plan 2 Task 2 rejects it
  at startup.
- Cross-collection search, `client.search({ zone })`, and any singleton search indexing.
- An embedded `type: 'tree'` field. Menus that want atomic publishing use a singleton with an
  array until that field is specified separately.

## Final verification

- [ ] `pnpm lint` — inspect the diff; revert unrelated reformatting
- [ ] `git diff --check` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] `pnpm test:integration` green (needs `pnpm db:init:test` and `pnpm db:init:test:mysql`)
- [ ] `pnpm byline:generate:check` passes — generated types current
- [ ] `pnpm knip` clean. This matters more here than in most plans: the work adds new exported
      services, types, and a handle module, and knip is CI-enforced on unused exports. An
      export that nothing consumes until Plan 4 needs an explicit decision — keep it internal,
      or record it in the knip config — not a silent CI failure on someone else's branch
- [ ] `pnpm knip:exports` clean
- [ ] A singleton can be declared, saved, read back, published, and re-read as published —
      end to end, through `@byline/client`, with no admin UI involved
- [ ] A private singleton whose `beforeRead` returns `false` for anonymous readers reads as
      `null` anonymously and returns content for an authorized actor
- [ ] Every commit carries a DCO `Signed-off-by` trailer and no others:
      `git log --format='%H %(trailers)' origin/develop..HEAD`
