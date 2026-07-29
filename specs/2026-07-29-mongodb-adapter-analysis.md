# MongoDB support (`@byline/db-mongodb`, `@byline/search-mongodb`) — shape analysis

Date: 2026-07-29
Status: theoretical — no implementation decision or delivery phase committed

Companions:
- `docs/03-architecture/01-document-storage.md` — the present-state typed EAV storage model.
- `docs/03-architecture/02-core-composition.md` — the permanent adapter boundaries.
- `docs/03-architecture/03-transactions.md` — the atomicity contract every database adapter must provide.
- `docs/06-search/04-provider-contract.md` — the provider-neutral search boundary.
- `specs/2026-07-24-db-mysql-adapter-design.md` — how the second relational adapter was introduced.
- `specs/2026-07-24-drizzle-free-adapters-analysis.md` — the adjacent question of adapters without Drizzle.

## Purpose

Byline now supports PostgreSQL and MySQL through database and search packages that share
the same public contracts. Those implementations prove that the typed EAV model and the
adapter boundary can survive a change of SQL dialect. MongoDB asks a stronger question:
can the same product behavior survive a different physical storage model?

The answer appears to be yes, with an important qualification. MongoDB should preserve
Byline's **logical storage model** — documents, immutable content versions, locale
semantics, current and current-published reads, paths, relations, trees, audit, counters,
and authorization-aware queries — but it should not automatically reproduce the seven
relational store tables.

The broad conclusion is:

1. The application-facing architecture can remain unchanged. `@byline/client`,
   document lifecycle services, hooks, authorization, patches, populate, and the admin
   user interface already depend on `IDbAdapter`, not on SQL.
2. `db-mongodb` would be a new storage implementation, not a dialect port. It must satisfy
   the full behavioral contract, including transactions, audit, trees, counters, locale
   fallback, system-field locking, and the admin repositories.
3. A first implementation should probably use an immutable BSON version document with an
   embedded, schema-aware storage payload and a materialized query projection, at a
   version or `(version, locale)` grain still to be decided. This retains Byline's proven
   flatten and restore semantics while avoiding relational reconstruction on every read.
4. MongoDB exposes a small relational leak in the current filter and sort intermediate
   representation. That representation should describe logical value kinds and paths,
   not only EAV store tables and SQL value columns.
5. `search-mongodb` is substantially more independent and more natural. The existing
   `SearchProvider` seam already receives a complete provider-neutral projection and can
   support MongoDB regardless of which database adapter stores the source content.

This document describes that general shape. It deliberately stops short of a detailed
implementation plan.

## The boundary that already holds

`IDbAdapter` is a broad contract rather than a small CRUD interface. It covers:

- collection registry reads and writes;
- immutable document versions and status-aware current reads;
- locale copy-forward, fallback, omission, and locale deletion;
- path uniqueness and non-versioned system fields;
- field filters, relation filters, combinators, sorting, and pagination;
- relationship population support;
- ordered collections and document trees;
- interactive transactions and authoritative locked snapshots;
- append-only audit writes and activity-feed reads;
- static and runtime-scoped counters; and
- the repositories used by Byline's admin identity and session system.

That breadth is an advantage here. Code above the boundary asks for behavior rather than a
driver primitive. The database conformance package is the executable definition of that
behavior. Its suites cover versioning, field types, restoration, locale semantics, paths,
trees and tree audit, transactions, counters, audit, and the admin store.

The following layers should therefore remain storage-neutral:

| Layer | Why MongoDB does not change it |
|---|---|
| `@byline/client` | It calls `IDbAdapter` queries and commands and receives reconstructed documents. |
| Document lifecycle services | They own authorization, hooks, transaction boundaries, and orchestration. |
| `beforeRead` authorization | It produces a logical `QueryPredicate` that the adapter compiles. |
| Patches and instance paths | They operate on documents before persistence. |
| Populate | It batches stable document ids through adapter queries. |
| Admin forms and field widgets | They never consume physical database rows. |
| Search document assembly | It produces `SearchDocument`, independently of the search engine. |

MongoDB would be the stronger proof that these are permanent contracts rather than
abstractions around two similar SQL implementations.

## The central storage decision

The main question is not whether MongoDB can store Byline documents. It is which physical
representation preserves Byline's semantics without importing the wrong costs from the SQL
implementation.

### A faithful EAV port

The most literal design would create separate MongoDB collections for text, numeric,
boolean, datetime, JSON, file, relation, and meta values. Reads would combine them with
`$unionWith` and `$lookup`, then pass the unified rows to `restoreFieldSetData`.

This provides the most direct code reuse, but it is unlikely to be the right production
shape. It would keep EAV's write amplification and reconstruction work while moving that
join-heavy workload onto a database whose primary strength is retrieving an aggregate as
one document. It should remain a useful reference implementation or test spike, not the
default architectural recommendation.

### A completely native BSON tree

The opposite design would store the reconstructed field tree directly on each immutable
version. Reads and selective projections would be natural, and values would retain BSON
types.

This is the most idiomatic destination, but it would replace a large amount of already
proven behavior at once. Locale-tagged leaves, whole-locale fallback, locale deletion,
stable block and array identity, schema-mismatch warnings, relation normalization, and
canonical numeric restoration would all need equivalent tree-native codecs. The model is
attractive, but it is the highest-risk starting point.

`docs/03-architecture/01-document-storage.md` evaluates the closest relational analogue to
this shape: one JSONB document per version. It prefers typed EAV for PostgreSQL because
field filtering and sorting require physical index planning, selective reads lose the
advantages of ordinary typed rows, and JSONB alone does not enforce Byline's declared field
types.

MongoDB changes the weight of those objections, but it does not erase all of them.
Server-side field projection prevents list reads from returning the complete document,
although the underlying storage cost still requires measurement. BSON preserves native
scalar types, while consistency for a declared field across documents and schema versions
remains the responsibility of Byline's write validation or maintained `$jsonSchema`
validators. Wildcard indexes reduce per-field declarations, but compound filtering,
sorting, and index selectivity remain physical design concerns.

The relational storage document therefore remains authoritative for PostgreSQL and MySQL,
but its conclusion should not be generalized unchanged to MongoDB. It neither proves nor
disproves a native BSON representation. The recommendation here remains the hybrid first
— not because BSON is unsuitable, but because replacing Byline's locale, identity, and
restoration codecs in the first adapter version would combine too many unproven changes.

### An embedded storage payload with a query projection

The strongest first candidate is a hybrid:

- one MongoDB document per immutable Byline document version;
- an embedded payload derived from `flattenFieldSetData`, retaining field paths, locales,
  value kinds, and stable item metadata;
- metadata such as document id, collection id, collection schema version, workflow status,
  actor, and timestamps on the version document; and
- a separate write-time projection containing the scalar values that `findDocuments`
  filters or sorts.

The embedded payload can continue through `restoreFieldSetData`, so the adapter reuses the
same schema-aware reconstruction and warning behavior as PostgreSQL and MySQL. A document
read becomes one keyed lookup rather than a union over seven stores.

The query projection matters. Filtering an array element with `$elemMatch` is
straightforward, but sorting by "the value whose field path is `title`" is not naturally
indexable when every value lives in one generic array. The adapter should hoist queryable
leaves into a Mongo-friendly projection at write time rather than extracting a sort value
inside every list aggregation.

The exact projection remains a design question. It might use nested typed maps, a small
array per primitive kind, or a combination of generic indexes and collection-specific
indexes. MongoDB wildcard indexes can reduce per-field index declarations, but they do not
make every compound filter-and-sort pattern efficient. Index selection must be validated
against Byline's actual list-query shapes.

This hybrid is recommended as the starting hypothesis, not as a settled implementation.
Its value is that it changes one variable at a time: the physical aggregate changes while
the proven locale, identity, path, and restoration codec remains available.

## A plausible MongoDB data shape

The adapter would still own several collections because not every Byline concept belongs
to the immutable content aggregate.

| Byline concern | Likely MongoDB representation |
|---|---|
| Collection definitions and fingerprints | `byline_collections` |
| Stable document metadata | `byline_documents` |
| Content history | `byline_document_versions`, one BSON document per version |
| Current administrative reads | Materialized current projection or an indexed current pointer |
| Current published reads | Separate materialized published projection or pointer |
| Paths | `byline_document_paths` with a unique `(collectionId, locale, path)` index |
| Advertised locales | Embedded on the stable document or stored in a dedicated collection |
| Tree placement | `byline_document_relationships` adjacency documents |
| Audit | Append-only `byline_audit_log` |
| Counters | One atomic counter document per declared or runtime scope |
| Admin identity and sessions | Dedicated user, role, permission, preference, and token collections |

### Current and current-published documents

PostgreSQL and MySQL compute the current rows with window-function views. The status filter
is applied before the published window, which lets a previously published version remain
public while a newer draft is edited.

MongoDB should probably materialize this state instead of reproducing the window on every
query. A stable document could maintain `currentVersionId` and
`currentPublishedVersionId`, or the adapter could maintain current projection collections
containing the queryable content itself.

Pointers alone make keyed reads simple, but list filtering and sorting would still need a
join to the version collection. Materialized current projections are therefore the more
promising shape for `findDocuments`: they duplicate derived data, but they let the adapter
query one indexed collection. A transaction must update the immutable version, stable
document state, and affected projection atomically.

This is the materialized-current end state already identified in the relational storage
analysis for large collections. MongoDB would begin with it rather than first implementing
a computed view.

Version creation is not the only event that invalidates these projections, and this is easy
to get wrong. Status changes mutate an existing version in place rather than minting a new
one. Publishing, unpublishing, `archivePublishedVersions` — which updates every version of
a document holding a given status — and `softDeleteDocument` — which flips `is_deleted`
across all of them — can change the selected version, projected status metadata, or
membership in one or both materialized projections without inserting a version. An
implementation built around version inserts alone could therefore leave derived state
silently stale. Every status-mutating and delete command must participate in the same
transactional projection maintenance.

The projection's contents are constrained by locale filtering too. `onMissingLocale:
'omit'` restricts a list read to versions whose content is available in the requested
locale. The relational adapters evaluate this against the version-locale availability
ledger before pagination, including the `'all'` sentinel for locale-agnostic content. A
MongoDB current projection must therefore carry equivalent version-grain availability
metadata — or join an indexed availability collection — before `$skip`, `$limit`, and
total calculation. Resolving availability after pagination produces short pages and
incorrect totals. The editorial `availableLocales` set is separate and does not control
this gate.

### Paths, relations, and trees

Paths should remain outside the version payload because they are document-grain,
non-versioned system fields. A dedicated collection makes case-sensitive uniqueness on
`(collectionId, locale, path)` explicit and keeps `getDocumentByPath` efficient.

Relations can remain stable target document ids inside the version payload. Populate still
collects those ids and asks the adapter for batches of current target documents. Nested
relation predicates are more involved: the adapter must compile `$some`, `$every`, and
`$none` into aggregation lookups against the selected current view, respecting deleted,
unpublished, and `beforeRead`-hidden targets.

Document trees remain adjacency data outside content versions. MongoDB's `$graphLookup`
can express ancestor and descendant traversal, but it does not by itself solve concurrent
placement, cycle prevention, or stale-neighbor conflicts. Those invariants still require
transactional compare-and-set operations or a scoped lock document. The existing tree
conformance suites, especially their concurrency and audit cases, remain the standard.

## Contract hardening exposed by MongoDB

The application-facing contract can remain intact, but MongoDB reveals several places
where its internal vocabulary should become more storage-neutral.

### Logical filter and sort descriptors

`FieldFilter` and `FieldSort` currently contain `storeType` and `valueColumn`, populated
from `fieldTypeToStore`. Those values tell a relational adapter which EAV table and column
to compare. A MongoDB adapter could reverse-map them, but that would make a leaked physical
detail part of a second physical implementation.

The query intermediate representation should additionally carry logical information such
as:

- the canonical field or declaration path;
- the normalized scalar kind: string, integer, float, decimal, boolean, date, time,
  timestamp, JSON, or document reference;
- localization behavior; and
- relation cardinality where relevant.

PostgreSQL and MySQL could continue consuming `storeType` and `valueColumn` during a
transition. MongoDB would consume the logical kind and compile it into `$match`,
`$elemMatch`, `$lookup`, and aggregation expressions. This is a small seam-hardening
change with value beyond MongoDB.

### Type normalization

The adapter must preserve Byline's canonical JavaScript shapes rather than expose driver
types:

- integers and floats return as `number`;
- decimals remain precision-preserving strings, even if stored as BSON Decimal128;
- dates, times, and timestamps retain the same precision and read shape as the SQL
  adapters;
- stored file sizes return as numbers;
- UUIDv7 document and version ids remain stable string ids unless a shared codec explicitly
  chooses BSON UUIDs; and
- arbitrary JSON and rich-text values pass through a BSON compatibility boundary without
  leaking driver-specific wrappers.

The embedded payload also needs a write-time uniqueness check for `(fieldPath, locale)`.
Unlike separate EAV rows with a unique database constraint, duplicate entries inside one
document array cannot be rejected by the same kind of index.

### Referential integrity

MongoDB does not provide relational foreign keys. The adapter must therefore enforce
target existence, same-collection tree edges, cascade behavior, and cleanup consistency
explicitly. Some invariants can be checked during lifecycle writes; others may require
maintenance and integrity-report tooling.

That is a meaningful operational difference. Behavioral parity does not imply that raw
database writes outside Byline have the same protection as PostgreSQL or MySQL.

## Transactions and concurrency

Interactive transactions are non-negotiable in Byline. A mutation and its audit row must
commit together; tree deletion must combine the soft delete, child promotion, edge
removal, and audit writes; system-field updates require an authoritative snapshot.

MongoDB supports multi-document transactions on replica sets and sharded clusters, but a
standalone deployment does not. A canonical adapter would therefore:

- fail fast at boot when the connected topology cannot provide transactions;
- make local development use at least a single-node replica set;
- use `AsyncLocalStorage` to carry a MongoDB `ClientSession` through the existing
  `withTransaction(fn)` boundary;
- route every transaction-aware database operation through one executor/session accessor;
  and
- run operations sequentially inside a Node.js driver transaction.

MongoDB has no transaction savepoints or nested transactions. This is the clearest semantic
gap with the current Drizzle implementation, whose nested command transactions use
savepoints. A MongoDB implementation cannot silently claim that behavior.

There are two plausible resolutions:

1. nested `withTransaction` calls join the ambient transaction, with any uncaught failure
   aborting the complete unit; or
2. lifecycle and command call graphs are refactored so nested transaction/savepoint
   behavior is no longer part of the required cross-adapter semantics.

The shared conformance suite currently proves commit-together and rollback-together. Before
MongoDB becomes canonical, the project should decide whether savepoint-local rollback is a
product contract or merely a property of the SQL implementations.

MongoDB also has no direct equivalent of `SELECT ... FOR UPDATE`.
`getDocumentSystemFieldsForUpdate` would need a write-based mutex, a revision increment, or
an optimistic compare-and-set inside the transaction. Tree moves need a similar strategy
at the sibling-group or tree scope so two writers cannot claim the same asserted gap.

Counters map cleanly to atomic `$inc` operations. They should probably remain outside the
ambient document transaction, matching the current gap-tolerant semantics and avoiding a
hot counter document being locked for the duration of a longer content transaction.

## Size and performance boundaries

One BSON document per version creates a hard maximum version size: MongoDB limits a BSON
document to 16 MiB. Byline stores file bodies outside the database, so most documents
should remain well below that ceiling. The multiplier that matters is not one large value
but locales. A versioned write carries every untouched locale forward under the new
version id, so a version-grain aggregate holds the whole document in every locale it is
available in. A few locales with moderate rich text stays far from the limit; fifteen
locales with substantial rich text in each is where the ceiling becomes reachable. The
adapter must reject such a write with an actionable error rather than truncate content.

That makes the **grain of the aggregate** a design question in its own right, sitting
alongside the hybrid-versus-native choice rather than following from it:

- **One document per version.** The most direct mapping of the current row set, and the
  only shape in which `getDocumentByVersion` at `locale: 'all'` — the read that
  `restoreDocumentVersion` depends on — is a single keyed lookup. It carries the full
  locale multiplier into the 16 MiB ceiling, and `deleteDocumentLocale` becomes a payload
  rewrite rather than a delete.
- **One document per `(version, locale)`.** Divides the ceiling by locale count. The
  common read — the admin editor and every public read request a single locale — becomes a
  bounded two-document fetch: the requested locale plus the shared `all` partition holding
  non-localized values. `deleteDocumentLocale` becomes a delete. The costs are that
  whole-version reads fan out across every available locale, and that the query projection
  must still be maintained at document grain rather than per partition.
- **A chunked payload.** Worth keeping as a later escape hatch if a deployment exceeds the
  ceiling within a single locale, but it gives up the single-document read property that
  motivates the hybrid in the first place.

Neither of the first two is obviously correct. The choice depends on how many locales real
deployments carry, and on how often whole-version reads occur relative to single-locale
reads — both measurable rather than arguable.

The more important uncertainty is list-query performance:

- Can the query projection support typed filters and indexed sorts without excessive
  duplication?
- Do wildcard or generic multikey indexes remain selective at realistic collection sizes?
- How expensive are nested relation predicates and `beforeRead` combinators?
- Does maintaining two current projections materially increase write cost?
- How does the representation behave at 10k, 50k, and 100k documents under the existing
  storage benchmark shapes?

Those questions should decide between the hybrid and a fully native BSON representation.
They should not be answered by analogy with either PostgreSQL or MongoDB marketing.

## Migrations and package shape

`@byline/db-mongodb` would be the first database adapter without a Drizzle dialect.
MongoDB does not remove migrations; it changes what they contain. The adapter would still
own:

- collection creation where explicit creation is useful;
- compound, partial, wildcard, and TTL indexes;
- `$jsonSchema` validators where they add durable protection;
- data-shape migrations for stored versions and projections; and
- a migration ledger recording applied adapter migrations.

An ordered stream of idempotent JavaScript or TypeScript migration functions is a more
natural artifact than SQL files.

This would require the CLI and installer to understand an adapter-owned migration
mechanism rather than assuming every database package supplies SQL. That generalization is
useful in its own right and should be designed for an open set of adapters, not as a
MongoDB special case.

The package would likely mirror the current public shape:

- `@byline/db-mongodb` — adapter factory, client handle, migrations, and error
  classification;
- `@byline/db-mongodb/admin` — admin repositories;
- an adapter-owned testing entry point; and
- a MongoDB conformance entry that runs the shared database suites against a replica-set
  test deployment.

## `search-mongodb`

The search provider is the cleaner half of the proposal.

`SearchProvider` receives one complete `SearchDocument` per
`(collectionPath, documentId, locale)`. The projection already contains status, zones,
title, path, typed fields, roles, boosts, and update time. A search provider does not read
source CMS tables or know how those documents were stored.

Consequently:

- `search-mongodb` does not require `db-mongodb`;
- `db-mongodb` does not require `search-mongodb`; and
- a PostgreSQL- or MySQL-backed Byline installation could use a MongoDB search provider if
  it deliberately configured one.

A MongoDB provider would likely own:

- one derived search document per `(collectionPath, documentId, locale)`;
- a unique index on that identity;
- collection, zone, locale, and status scope fields;
- original body text for display and highlighting;
- typed filter and facet projections;
- analyzer fingerprint metadata per collection; and
- provider-owned search index definitions and migrations.

### Self-managed MongoDB search

MongoDB's standard `$text` index is a possible foundation, but it is not automatically
equivalent to the current SQL providers. A collection can have only one standard text
index, and `$text` alone does not directly implement Byline's complete matching floor:

- all versus any source concepts;
- minimum-should-match;
- exact ordered phrases with phrase opt-out;
- portable analyzer fingerprint behavior; and
- highlighted original-text snippets.

A self-managed provider would probably need to store portable token and phrase projections
from `@byline/search-analysis` and implement part of the matching and ranking behavior in
an aggregation pipeline. It might still be viable, but it must pass
`@byline/search-conformance`; wrapping `$text` and advertising parity would not be enough.

### MongoDB Search / Atlas Search

MongoDB Search is the more natural and strategically interesting implementation. Its native
search indexes can provide analyzers, compound text and filter queries, scoring,
highlighting, fuzzy matching, faceting, and search-oriented pagination.

The mapping from Byline's projection is direct:

- `body` fields become analyzed search fields;
- `filter` fields become exact, numeric, boolean, or date fields;
- `facet` fields become facet-enabled exact values;
- field boosts become score modifiers; and
- collection, zone, locale, and status become compound filters.

The provider should still declare only capabilities that it actually implements and tests.
Atlas may make `facets`, `typoTolerance`, `weighting`, `highlights`, and native analysis
reasonable targets, but the presence of an engine feature is not enough to set the flag.

In particular, `SearchCapabilities.semantic` should remain false until Byline's
application-facing query contract can express vector or hybrid intent and the provider
implements that contract. The current `SearchQuery` carries a lexical query string; a
vector-search facility existing in the backend does not by itself create a semantic Byline
API.

Self-managed search and MongoDB Search have sufficiently different capability and
operational profiles that they should use separate factories and may deserve separate
packages. One `search-mongodb` name should not silently mean "basic portable aggregation"
in one deployment and "managed native search" in another without making that distinction
explicit.

## Conformance and evidence

The shared conformance packages remain the definition of correctness:

- `@byline/db-conformance` for database and admin behavior;
- `@byline/search-conformance` for provider capabilities, lifecycle, scope, matching,
  highlighting, weighting, portable analysis, and analyzer rebuild enforcement.

MongoDB may expose assumptions that are currently relational despite appearing behavioral.
Those cases should be made explicit rather than weakening tests until a new adapter passes.
Savepoint semantics, counter transaction participation, ordering ties, and raw referential
integrity deserve particular scrutiny.

Performance is a separate dimension. Passing conformance proves that users observe the
same behavior; it does not prove that the chosen representation has acceptable list,
relation, or tree-query costs. The existing storage benchmark harness should be extended
to run the same logical workloads against MongoDB before the physical model is settled.

## Code and contract anchors

| Concern | Present source |
|---|---|
| Database contract | `packages/core/src/@types/db-types.ts` |
| Query predicate parsing and relational filter hints | `packages/core/src/query/parse-where.ts` |
| Field-type to EAV-store mapping | `packages/core/src/storage/field-store-map.ts` |
| Schema-aware flattening | `packages/core/src/storage/storage-flatten.ts` |
| Schema-aware restoration | `packages/core/src/storage/storage-restore.ts` |
| Database behavioral suites | `packages/db-conformance/src/` |
| PostgreSQL adapter composition | `packages/db-postgres/src/index.ts` |
| MySQL adapter composition | `packages/db-mysql/src/index.ts` |
| Search document and provider contracts | `packages/core/src/@types/search-types.ts` |
| Search behavioral suites | `packages/search-conformance/src/` |
| PostgreSQL search reference | `packages/search-postgres/src/postgres-search-provider.ts` |
| MySQL search reference | `packages/search-mysql/src/mysql-search-provider.ts` |

The MongoDB-specific constraints used in this analysis come from MongoDB's current
documentation:

- [BSON documents have a 16 MiB maximum size](https://www.mongodb.com/docs/manual/core/document/).
- [Multi-document transactions require a replica set or sharded cluster; standalone deployments do not support them](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).
- [The Node.js driver does not support parallel operations within one transaction](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/).
- [MongoDB transactions do not provide nested transactions or savepoints](https://www.mongodb.com/docs/entity-framework/current/interact-data/transactions/).
- [A self-managed collection can have at most one standard text index](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/text-index-restrictions/).
- [MongoDB Search provides analyzers, scoring, pagination, and faceting](https://www.mongodb.com/docs/atlas/atlas-search/tutorial/build-applications/).
- [MongoDB Search highlighting returns matched source passages](https://www.mongodb.com/docs/atlas/atlas-search/highlighting/).

## Honest assessment

### What argues for it

- MongoDB support would materially broaden the environments in which Byline can be
  adopted.
- A document CMS over a document database can make full-version reads simpler than the
  relational EAV path.
- It is the strongest practical test of whether `IDbAdapter` is genuinely
  storage-neutral.
- The logical filter/sort IR and non-SQL migration seam would improve the architecture for
  future adapters too.
- A MongoDB Search provider could exercise capability paths that the current PostgreSQL
  and MySQL providers deliberately do not claim.

### What argues for caution

- This is a third storage model, not a third dialect, so query code will share little with
  the relational adapters.
- The replica-set requirement raises the minimum operational complexity for local
  development and production.
- MongoDB replaces database-enforced foreign keys with application-enforced integrity.
- One-version-per-BSON-document introduces a hard size ceiling.
- Query projections and indexes may reintroduce schema-sensitive physical management even
  though collection field changes do not require table migrations.
- Documentation and benchmarks would need a storage-model axis instead of presenting typed
  relational EAV as the only physical model.

## Conclusion

MongoDB can implement Byline's contracts without changing the application-facing product.
The right goal is behavioral parity, not physical parity.

For `db-mongodb`, the best starting hypothesis is:

- immutable version documents;
- an embedded flattened payload — at a grain still to be decided — to retain the existing
  locale, identity, and restoration semantics;
- materialized current and current-published query projections;
- dedicated collections for paths, trees, audit, counters, and admin identity;
- a logical filter and sort intermediate representation;
- transaction-aware operations over a replica set or sharded cluster; and
- conformance plus benchmark evidence before declaring the physical model settled.

For search, the existing provider boundary is already suitable. A self-managed MongoDB
provider would require more than a thin `$text` wrapper to meet the current matching floor,
while a MongoDB Search provider could become Byline's first genuinely capability-rich
search implementation. The two should remain explicitly distinguishable.

The decisive open questions are therefore not whether MongoDB can support Byline. It can.
There are two, and a technical spike should answer both before the physical model is
settled:

1. **Can the hybrid carry the query load?** Whether an embedded version payload plus a
   materialized query projection supports Byline's typed filters, indexed sorts, locale
   behavior, and nested relation predicates efficiently enough to justify that shape over
   a fully native BSON codec.
2. **What is the grain of the aggregate?** Whether the version payload is partitioned by
   locale. This decides the practical reach of the 16 MiB ceiling, the cost of locale
   deletion, and the shape of whole-version reads — and it feeds back into the first
   question, because a smaller per-locale aggregate has different index and projection
   economics than a single version-grain document.

Both are measurable. Neither should be settled by analogy with the relational adapters.
