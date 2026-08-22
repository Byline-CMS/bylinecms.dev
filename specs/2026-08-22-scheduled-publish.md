# Scheduled publication — working design

Date: 2026-08-22
Status: working design; not approved for implementation
Companions:

- `specs/2026-08-22-scheduler.md` — the shared in-process recurring-task runner.
- `specs/2026-08-22-analytics-spec.md` — the other initial scheduler consumer.
- `docs/07-auth-and-security/01-authn-authz.md` §6 — the existing read-time embargo
  recipe, which is a different feature.

## Goal

Allow an authorized editor to choose a future instant at which a specific reviewed document
version moves through Byline's normal workflow transition to `published`. Publication must use
the existing authorization, hook, audit, cache-invalidation, search-indexing, and auto-archive
behaviour rather than changing a status column behind the lifecycle layer.

The feature runs from the ordinary application process. It uses the shared recurring-task
scheduler and requires no queue, worker service, or one-off task payload table.

## Product semantics

Scheduled publication is a delayed workflow mutation, not a read filter:

- Before the scheduled instant, public reads continue to exclude the document because its
  current version is not `published`.
- At or shortly after that instant, Byline performs the same status transition as an authorized
  immediate publish action.
- Normal `beforeStatusChange` and `afterStatusChange` hooks run, so search and cache integrations
  see the publication.
- If the application is unavailable at the instant, the next healthy sweep publishes overdue
  schedules. Schedules do not expire merely because they are late.
- Publication is document-grain. The version that publishes carries every locale it was authored
  with, so scheduling publishes all of a version's locales together. There is no per-locale
  schedule in v1.

This differs from the existing embargo recipe, where content is already considered published and
a `beforeRead` predicate hides it until request-time `now`. Embargoes can lift without a running
scheduler but interact poorly with caches and do not emit a publication lifecycle event. Both
features may remain available, but the admin UI must not present them as the same mechanism.

## Decisions

| Question | Decision |
|---|---|
| Data grain | Unversioned document lifecycle metadata, not a collection field |
| Storage | Dedicated `byline_document_publish_schedules` table, one active row per document |
| Target | The exact current version at scheduling time |
| Edit after scheduling | Creating a newer content version suspends the schedule; it is retained, refuses to fire, and needs one explicit re-confirmation |
| Timer | Shared `documents.publish-scheduled` recurring task, one-minute interval |
| Authorization | Captured when the schedule is armed, not re-checked at fire time; recorded in `last_authorized_by`; no new role concept |
| Execution actor | Stable system actor/context built in core; the human actors remain in schedule audit history |
| Time | Store an absolute UTC instant; render and edit it with an explicit IANA time zone |
| Multi-instance safety | Global recurring-task lease plus conditional per-schedule execution token |
| Failure | Independent per-document attempts; one failure never blocks other due documents |
| Locales | A schedule is document-grain; publishing a version publishes every locale that version carries |

## Enablement

Scheduled publication is an optional installation feature. Enabling it registers the recurring
task and the admin document control; it does not add a collection schema field. In v1, enablement
applies to every collection whose workflow has a valid transition to `published`. Eligibility is
then determined per document from its current state and the actor's abilities. A per-collection
feature flag is deferred until an installation demonstrates a need for one.

Core boot fails clearly if the feature is enabled without a scheduler-capable database adapter.
The deployment must also call the host's explicit scheduler start function; because the absence
of a timer cannot be proven during inert core initialization, scheduler health and the admin
module surface a stopped/stale task. They cannot make a scale-to-zero deployment run timers.

## Why this is system metadata

`scheduledPublishAt` describes what Byline should do to a document, not the document's authored
content. It is common to every publishable collection, is not localized, should not be returned as
a user-defined schema field, and must not mint a content version when changed.

The separate schedule table is preferable to a collection datetime field or a nullable column on
every version:

- one row exists only while a schedule is active;
- `publish_at` has a narrow due-work index;
- the row can name and guard the target version, and can outlive that version's supersession as
  a suspended schedule awaiting re-confirmation;
- scheduling audit and attempt health do not pollute EAV content;
- foreign keys can cascade with the document without creating a document-to-version reference
  cycle; and
- both SQL adapters can implement the same behaviour without teaching schema inference or code
  generation that this is authored content.

Client/admin read shapes may expose the resolved system metadata as `scheduledPublishAt` and
`scheduledPublishVersionId`. Generated collection field types do not change.

## Data model

Logical schema; Postgres and MySQL use their established UUID and UTC timestamp conventions:

```text
byline_document_publish_schedules
  document_id          primary key, foreign key -> byline_documents.id on delete cascade
  collection_id        not null, foreign key -> byline_collections.id on delete cascade
  target_version_id    not null, foreign key -> byline_document_versions.id on delete cascade
  publish_at           not null
  state                not null default 'armed'
  suspended_at         nullable
  suspended_reason     nullable
  scheduled_by         nullable
  last_authorized_by   nullable
  last_authorized_at   not null
  scheduled_at         not null
  updated_at           not null
  execution_token      nullable
  execution_expires_at nullable
  last_attempt_at      nullable
  next_attempt_at      not null
  attempt_count        not null default 0
  last_error           nullable

  index (state, next_attempt_at, publish_at)
  index (execution_expires_at)
```

`state` is `armed | needs_reconfirm`. Only an `armed` row is ever claimed for execution, so the
due-work index is expressed over armed rows alone: a partial index on `(next_attempt_at,
publish_at)` restricted to `state = 'armed'` in Postgres, and the equivalent
`(state, next_attempt_at, publish_at)` composite in MySQL, which has no partial indexes. The index
must cover the whole claim predicate rather than `publish_at` alone — a schedule in retry backoff
is due by `publish_at` but not by `next_attempt_at`, and an index that omits the latter degrades
into a scan of every overdue row on exactly the busy day when that matters.
`suspended_reason` is a bounded enum, not free text: v1 defines `content_edited`.

`scheduled_by` and `last_authorized_by` answer different questions and both are needed.
`scheduled_by` is historical — who first created this schedule. `last_authorized_by` is
operational — whose authorization the pending publication currently rests on, rewritten on every
action that arms the row: create, reschedule, and re-confirm. Once another editor can re-confirm a
schedule that a colleague originally created, `scheduled_by` no longer identifies the person
accountable for what will publish, which is precisely the question an administrator asks when
offboarding someone. `last_authorized_at` records when that authorization was captured.

`scheduled_by` records the authenticated admin actor id when one exists but is not a foreign key
whose deletion could remove or invalidate the schedule. The append-only audit log is the durable
accountability record. `last_error` contains a sanitized message capped at 2 KiB, never a stack or
document content.

`target_version_id` must belong to `document_id` and `collection_id`; driver commands validate
that relationship transactionally. Only one active schedule may exist per logical document.

## Scheduling and cancellation commands

The client collection handle gains explicit system operations rather than overloading content
`update()`:

```ts
schedulePublish(documentId, {
  publishAt: string,         // ISO instant
  expectedVersionId: string, // optimistic editor guard
})

confirmScheduledPublish(documentId, {
  expectedVersionId: string, // the version the editor has just reviewed
})

cancelScheduledPublish(documentId)
```

The admin server functions resolve the authenticated request context and call these lifecycle
services. Direct adapter commands remain internal, as with other lifecycle metadata.

### Schedule or reschedule

In one transaction, the service:

1. Requires `collections.<path>.changeStatus` and `collections.<path>.publish`.
2. Reads and locks the current document version.
3. Rejects a stale `expectedVersionId` with a conflict so an editor cannot schedule a version
   that changed underneath the form.
4. Validates that the current workflow permits its next transition to `published`.
5. Requires `publishAt` to be a valid future instant according to database time. An editor who
   wants publication now uses the normal Publish action.
6. Inserts or replaces the schedule row in state `armed`, clearing suspension, attempt, and
   execution state, and stamping `last_authorized_by` / `last_authorized_at` with the acting
   admin actor.
7. Appends an audit record describing schedule creation or rescheduling, including the previous
   and new UTC instants and target version id.

Changing only the publication time does not create a content version or reset workflow status.
Rescheduling an execution already being finalized returns a conflict and asks the editor to
refresh; it never silently races a publication in progress.

### Re-confirm a suspended schedule

`confirmScheduledPublish` is the recovery path for a schedule suspended by a content edit. It
requires the same two abilities as scheduling, and in one transaction it:

1. Locks the schedule row and rejects unless its state is `needs_reconfirm`.
2. Rejects a stale `expectedVersionId`, so the editor confirms the version they actually read.
3. Revalidates that the current workflow permits its next transition to `published`.
4. Retargets `target_version_id` to the current version, returns the row to `armed`, clears
   suspension and attempt state, restamps `last_authorized_by` / `last_authorized_at` with the
   confirming actor, and leaves `publish_at` untouched.
5. Appends an audit record naming the superseded and newly authorized version ids.

`publish_at` deliberately survives re-confirmation, including when it is already in the past. A
schedule confirmed after its instant is immediately due and publishes on the next sweep, which is
what an editor who fixed a typo on Thursday for a Friday morning post expects. An editor who
wants a different time reschedules instead, which re-arms the row through the ordinary schedule
path.

### Cancel

Cancellation requires the same two abilities because a schedule embodies authorization to
publish. The command deletes an unclaimed row immediately and appends a cancellation audit in the
same transaction.

Cancellation and publication both lock the schedule row in their decisive transaction. Whichever
transaction obtains that lock first wins: cancellation deletes the row and prevents the runner's
token-matched publication, while cancellation after publication reports that no active schedule
remains. This remains safe when execution has already been claimed because the runner rechecks
the row and token immediately before mutation. The UI must not claim that it cancelled a
publication when the publication transaction already committed.

Hard-deleting a document cascades its schedule through the foreign key. Every other invalidating
operation must clear the schedule explicitly and transactionally, and record why — see
"Interoperability and ways out" below, which states this as an invariant that holds for every
caller rather than for the admin interface alone. Soft deletion is the case that proves the point:
`softDeleteDocument` leaves the document row in place, so no cascade fires and the schedule
survives.

Be accurate about what that costs. The sweep re-reads state before mutating, so it classifies an
already-published or fully soft-deleted document as terminal and removes the stale row rather than
republishing it — the residue is not guaranteed republication. What it does produce is stale
state and a race. The schedule keeps appearing live in the admin until some sweep collects it; and
a sweep that claimed and read the document *before* the soft delete committed can go on to mutate
the tombstoned version, so a status set after deletion could surface if the document is later
restored. Transactional cancellation at the point of invalidation is what removes the race
window, which is why it is required rather than left to the sweep's terminal handling.

## Version safety

The schedule authorizes one reviewed version. A subsequent content update creates a new current
version and, transactionally as part of that update, moves the schedule to `needs_reconfirm` with
`suspended_reason = 'content_edited'`. A suspended schedule is never claimed and never publishes.
The audit entry states that editing suspended the schedule, and the admin editor shows a clear
notice after the save.

Suspending rather than deleting is the deliberate choice, and it is worth being explicit about
what it trades. Three behaviours are possible when scheduled content is edited:

- **Publish whatever is current at fire time.** Rejected: it publishes changes made after
  approval, which defeats the point of scheduling reviewed work.
- **Delete the schedule.** Rejected: it is safe but its failure mode is silent non-publication.
  An editor who fixes a typo two days before the scheduled instant, and does not read the toast,
  gets nothing published at the scheduled time and no durable record that anything was pending.
  For a feature whose entire purpose is "it goes live when I said it would," that outcome is
  worse than the risk it avoids, and it is reachable through the most ordinary editorial action
  there is.
- **Suspend the schedule.** Chosen: the safety property is identical to deleting — no unreviewed
  version can publish, because an `armed` state is reachable only through an explicit
  authorization command — but the pending intent survives as a durable row. Recovery is one
  confirmation at the original instant rather than reconstructing the schedule from memory, and,
  decisively, the suspended state is enumerable. The admin can list every schedule awaiting
  re-confirmation, which is what actually prevents the silent failure; a dismissed notice cannot.

Publishing an older pinned version while a newer draft is current remains out of scope: it would
complicate current-version resolution and surprise the editor.

Because an edit suspends rather than retargets, the runner's fire-time check that the target is
still the current version is a race guard rather than the primary mechanism. It stays: an edit
committing between claim and publication must not slip through.

Unversioned system changes such as path, advertised locales, and a schedule-time adjustment
neither cancel nor suspend the schedule. A status transition made outside the scheduled path
deletes it outright rather than suspending it, because the transition that was authorized at
scheduling time no longer exists and there is nothing for a re-confirmation to restore. "Outside
the scheduled path" means any caller of the lifecycle service — admin interface, `@byline/client`
SDK, CLI, a future HTTP or MCP transport — not an admin-interface action specifically.

## Recurring task

The feature contributes this definition to the shared scheduler:

```ts
defineRecurringTask({
  name: 'documents.publish-scheduled',
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  run: (context) => runScheduledPublicationSweep(core, context),
})
```

The exported, stable operation is `runScheduledPublicationSweep()`; `publishDueDocuments` is its
implementation detail. The recurring-task definition is a thin adapter over that service, not the
other way round, so an installation that drives the sweep from its own orchestration calls a
supported function rather than reaching for a task's incidental `run` callback.

That obliges the sweep to take an options shape an external caller can actually construct, rather
than a scheduler-minted `RecurringTaskContext`:

```ts
interface ScheduledPublicationSweepOptions {
  /** Abort in-flight work; the sweep checks it between batches. */
  signal?: AbortSignal
  /** Stop claiming new work after this long and return. */
  budgetMs?: number
  /** Maximum schedules claimed per batch. */
  batchSize?: number
  /** Called between batches by a lease-holding caller; omit when there is no lease. */
  heartbeat?: () => Promise<void>
  logger?: BylineLogger
}

runScheduledPublicationSweep(
  core: BylineCore,
  options?: ScheduledPublicationSweepOptions
): Promise<{ published: number; failed: number; workRemaining: boolean }>
```

The recurring task adapts its `RecurringTaskContext` onto this shape and maps the returned
`workRemaining` onto its task result. An external orchestrator passes whatever subset it has,
typically a `signal` and a `budgetMs`, and needs no lease of its own — per-document execution
tokens already make concurrent sweeps safe.

This is an **operational/system API, not a user-facing `CollectionHandle` operation**. It is
server-only, it takes no actor, and it publishes on behalf of authorizations captured earlier, so
it must never be reachable from an ordinary authenticated request path. Any future remote wrapper
around it is operator-gated — deployment-level credentials, not a content ability — and is
explicitly out of scope for v1.

`publishDueDocuments` repeatedly claims a bounded batch ordered by `publish_at`, oldest first,
until no eligible due row remains or a short execution budget is exhausted. **That within-run loop
is what drains a backlog**, not the scheduler: because this task's interval already equals the
tick cadence, re-arming it changes nothing about when the next run starts. The task still returns
`workRemaining: true` when the budget rather than an empty queue ends the run — it costs nothing,
it is accurate, and it stays correct if the interval is ever raised — but no reader should take it
as the reason a backlog clears quickly. Sizing the batch and the execution budget is the decision
that determines how fast overdue documents catch up. Claiming uses database time and an atomic condition:

```text
state = 'armed'
and publish_at <= database_now
and next_attempt_at <= database_now
and (execution_expires_at is null or execution_expires_at <= database_now)
```

The claim writes a fresh `execution_token`, an expiry, `last_attempt_at`, and the incremented
attempt count. Every later operation is conditional on that token. The task checks its global
scheduler lease and heartbeat between batches; the per-document token prevents a stale global
runner from completing work already reclaimed by another execution.

Each claimed document is isolated:

1. Re-read the schedule and current version.
2. If the target is no longer current, the document was deleted, or the transition is no longer
   valid, remove the obsolete schedule with an explanatory audit or warning and do not publish
   it.
3. Invoke the scheduled-publication lifecycle service with a stable system actor context.
4. The service runs `beforeStatusChange`, then transactionally locks and revalidates the claimed
   schedule, changes status, auto-archives other published versions, appends the normal system
   status audit, and removes the schedule.
5. Invoke `afterStatusChange` after commit, matching the existing status lifecycle boundary.

The transaction in step 4 is the decisive fence. A token that expired or a cancellation that won
the row race produces no status mutation. The implementation refactors the common transition internals
into a primitive shared with `changeDocumentStatus()` rather than creating a second, subtly
different hook and audit path; see "The transition primitive must be extracted, not called" below,
which makes that a prerequisite of the atomicity guarantee rather than a stylistic preference.

### Execution actor and the package boundary

The task runs inside core, so it must not reach for `getSystemBylineClient()`. That getter lives in
`@byline/client/server`, and `@byline/client` depends on `@byline/core` — core cannot depend back
without creating a cycle. The resolution is not to move the task downstream but to observe that
core already has everything it needs: `createSuperAdminContext` is exported from `@byline/auth`,
which core depends on, and is the same function the client getter calls. Core therefore builds the
system `RequestContext` directly. The vocabulary throughout this document is deliberately
**system actor / system context**, never "system client."

### The transition primitive must be extracted, not called

Scheduled publication cannot simply call the existing `changeDocumentStatus()`
(`packages/core/src/services/document-lifecycle/status.ts`). That function opens its own
`audit.withTransaction()` and, inside it, mutates status, auto-archives other published versions,
and appends the status audit. The transaction is closed to callers: it knows nothing about a
schedule row, an execution token, or schedule deletion, and it commits before returning. Calling it
and then deleting the schedule afterwards produces two transactions, and a crash between them
leaves a published document with a live schedule row. The next sweep would re-read that document,
find the transition already satisfied, and — because a same-status transition validates as a
no-op — could re-run the transition rather than treat it as terminal, appending a duplicate status
audit and firing `afterStatusChange` a second time. Publication is not duplicated, but
accountability and hook delivery are, and the schedule reads as pending in the admin until
collected. One transaction removes the window entirely.

The requirement in this document that status mutation, auto-archive, audit, and schedule removal
commit or roll back together therefore obliges a refactor: **extract the transition internals into
a shared primitive that runs within the ambient transaction boundary and accepts contribution
callbacks**, and have both `changeDocumentStatus()` and scheduled publication call it. The
primitive invokes one callback before the status write, able to abort the transaction, and one
after the audit append; scheduled publication supplies the token-matched schedule guard and the
schedule deletion through them. This is the earlier instruction to refactor common transition
internals rather than build a parallel path, restated as a prerequisite rather than a preference,
because the atomicity guarantee cannot be met without it. One lifecycle implementation, two entry
points.

Byline's transactions are **ambient rather than handle-passing** — the canonical PostgreSQL and
MySQL adapters both resolve each command to the open `withTransaction` boundary when one exists
(each propagating it through `AsyncLocalStorage`), which is how audit writes already enlist
alongside the mutations they record. Nothing needs a transaction object threaded
through its signature, and the schedule commands enlist automatically by being issued inside the
boundary. The work here is confined to opening a seam in one function; it is not a signature
cascade through the lifecycle layer.

Contribution callbacks run directly inside the existing ambient transaction and must not open
their own. Any failure — especially a rejected token guard — must propagate out of the outer
`withTransaction`; catching it inside a nested transaction would roll back only that transaction's
savepoint and could allow the status mutation to commit. Nesting is a savepoint rather than a flat
join in both canonical adapters, so this is a plausible mistake with correctness consequences
rather than a theoretical one.

**Scope is deliberately pinned to this seam, and the contributions differ per caller.** The
primitive does not embed a blanket "cancel any schedule" step, because its two callers need
opposite things: ordinary `changeDocumentStatus()` contributes *cancel any active schedule*, while
scheduled execution contributes its *token-matched guard and deletion*. Embedding the generic
cancellation would make the scheduled path destroy the row by two mechanisms at once, and would
still miss every operation that never passes through this function.

That last point matters more than the extraction itself. `unpublishDocument()`, soft deletion, and
any future invalidating operation do **not** route through this primitive, so each needs its own
transactional cancellation. Adding those calls is in scope; unifying those functions' transaction
handling with this one is not. The extraction serves scheduled publication and stops there — a
second consumer, not tidiness, is what would justify widening it.

The contribution callbacks are an internal seam, not a public extension point. They are not
exported, not documented as an API, and not a substitute for collection hooks.

The refactor's risk is its blast radius rather than its difficulty. `changeDocumentStatus()` has
two production callers — the host's status server fn and `CollectionHandle.changeStatus()`, which
is public `@byline/client` API — so it sits beneath every collection's admin status control and
beneath a published SDK surface that downstream applications call. Implementation planning should
therefore land the extraction and its tests as their own step, green, before any scheduled-publish
code is written on top of it, so that a status regression is attributable to one small commit
rather than entangled with a new feature.

What that step can prove is bounded by what exists at the time. No schedule table has been created
yet, so it cannot test schedule survival. It tests the seam on its own terms: that contributions
run in the specified order relative to the status write and the audit append, that a throwing
before-contribution aborts the transaction with no status change and no audit row, and that a
throwing after-contribution rolls the status write back. The schedule-specific atomicity
test — force a failure after the status write, assert the schedule survives and the document
remains unpublished — belongs with the schedule adapter integration work, once there is a row to
observe.

The actor identity that appears in the audit row is whatever `createSuperAdminContext` stamps.
Implementation must read that value from `@byline/auth` rather than assuming a particular string;
this document does not name one.

Schedule creation, rescheduling, re-confirmation, cancellation, and edit suspension retain the
human actor in separate audit rows.

**Authorization is captured when a schedule is armed and is not re-checked at fire time.** This is
a decided policy, not an open question. Deleting the authorizing user or revoking their permissions
does not revoke a schedule that was validly authorized; cancellation is an explicit action.

The alternative — re-validating the authorizing actor's abilities at publication time — sounds
safer and is worse. It makes every ordinary permission change able to silently stop scheduled
publication: someone moves teams, a role is renamed, a permission set is tightened, and posts
quietly stop going out with nothing connecting the cause to the effect. That trades a rare and
visible risk for a frequent and invisible one, which is the same bargain this design already
rejected for cancel-on-edit.

The retained policy has a consequence that must be stated plainly rather than discovered during a
security review: an editor offboarded on Thursday still publishes content on Friday. Three things
follow, and all three are requirements rather than advice. The behaviour is documented in
`docs/07-auth-and-security/` alongside the rest of the authorization model, not only here.
`last_authorized_by` records whose authorization each pending publication rests on. And revoking an
account's access must include an operational step that lists and cancels that account's pending
schedules — the admin listing below is what makes that step possible, which is part of why it is
required for v1.

## Failure behaviour

Database and pre-commit hook failures leave the schedule active. The task records a bounded error,
releases the execution claim, and sets `next_attempt_at` from a small 1, 2, 4, 8, then 15-minute
maximum backoff. Rescheduling resets it to the new `publish_at`. The task continues other
documents rather than failing the whole sweep.

An `afterStatusChange` failure occurs after publication committed, matching the existing lifecycle
semantics. The schedule is already gone and publication is not retried; the error is logged and
the normal status audit proves what committed.

A workflow state that no longer permits the transition is terminal for that schedule, not
retryable, and the row is removed with an audit/warning so it cannot remain overdue forever. A
target version that is no longer current is handled differently: because a content edit suspends
the schedule rather than deleting it, the runner treats the same discovery as a suspension too,
moving the row to `needs_reconfirm` rather than discarding the editor's intent.

The admin document view surfaces active schedules that are overdue and the latest bounded attempt
error. Scheduler health separately shows whether the recurring task itself has stopped running.

## Time-zone behaviour

The database stores `publish_at` as an absolute UTC instant. Due comparisons use database UTC
time; application-machine clock skew cannot publish early or retain a lease indefinitely.

The editor displays the IANA time-zone name beside the date-time control and converts the selected
wall time to an ISO instant before submission. On another machine, the same instant may render in
that editor's configured or browser time zone. Ambiguous or nonexistent daylight-saving wall times
must require an explicit valid choice rather than silently shifting the time.

V1 may use the browser's IANA zone when Byline has no installation/admin time-zone setting, but
the zone must remain visible. A future configured editorial zone can replace that default without
changing the stored value.

## Admin interface

The document action area shows one of:

- **Schedule publication** when the current transition to `published` is valid and the actor has
  both required abilities;
- **Scheduled for _date, time, zone_**, with Reschedule and Cancel actions;
- **Needs re-confirmation — was scheduled for _date, time, zone_**, explaining that the content
  changed after scheduling, with Confirm, Reschedule, and Cancel actions; or
- **Publication overdue / retrying**, with the last bounded error and Cancel action.

Scheduling is unavailable for single-status workflows, an already-published current version,
deleted documents, or a workflow state that cannot transition directly to `published`. Immediate
Publish remains available and clears any schedule as part of the same lifecycle action.

The control warns that saving content after scheduling suspends the schedule. After such a save,
the editor receives a visible, non-ambiguous notice and must confirm the newly reviewed version
before it will publish.

A dismissed notice is not a durable signal, so the admin must also expose schedules away from the
document that produced them: a cross-collection listing of active and suspended schedules,
reachable from the admin area. This listing is what turns "the editor did not notice" from silent
non-publication into a visible queue, and it is the same surface an administrator uses to find and
cancel an offboarded account's pending schedules. It is required for v1, not deferred.

Because it spans collections, it must be filtered per row rather than gated once. Abilities in
Byline are collection-scoped (`collections.<path>.changeStatus`, `collections.<path>.publish`), so
the listing shows a schedule only when the viewing actor holds both abilities for that schedule's
own collection. A single page-level permission check would leak the existence, paths, and timing of
scheduled content in collections the viewer cannot otherwise see. The listing shows
`last_authorized_by` for each row, since finding one account's pending schedules is one of its two
reasons to exist.

**The filtering is computed above the storage layer, not inside it.** The database adapters stay
actor- and ability-agnostic, as they are everywhere else in Byline. The core service resolves the
actor's abilities into a bounded allowlist of collection ids — those for which the actor holds both
`changeStatus` and `publish` — and passes that allowlist into the query; the adapter's only
obligation is to enforce `collection_id IN (…)`. An empty allowlist returns an empty listing
without issuing a query. Teaching the adapter to evaluate abilities would put authorization logic
in two places and break the boundary that keeps `assertActorCanPerform` and the ability registry
above storage.

## Adapter and lifecycle boundaries

Core owns schedule types, validation, authorization, lifecycle orchestration, audit actions, and
the recurring task definition. The canonical SQL adapters own schema/migrations and commands for:

- schedule, reschedule, re-confirm, cancel, and read, including a cross-collection listing of
  active and suspended schedules restricted to a caller-supplied allowlist of collection ids;
  the adapter enforces that allowlist but never evaluates abilities itself;
- suspend-on-new-version and cancel-on-status-change inside the ambient transaction;
- claim due schedules and release failed claims;
- lock and validate a token-matched schedule during publication, and delete it inside the
  caller's ambient transition transaction; and
- expose schedule metadata with document system fields.

The storage operations join the existing `IDbAdapter` document command/query surface rather than
being called directly by admin routes. Postgres and MySQL pass the same conformance suite.

## Interoperability and ways out

Byline's posture is batteries included, seams exposed. Scheduled publication ships with a table, a
sweep, a ticker, and an admin surface, but it must not become the only road to publication, and a
larger installation with its own orchestration must be able to choose whether to use the subsystem
at all, and to replace its trigger, without forking. This section states what is guaranteed, because the guarantees are otherwise scattered
across three documents.

The largest exit is the simplest one: **an external orchestrator does not need this subsystem at
all.** A system that decides for itself when content goes live calls
`client.collection(x).changeStatus(id, 'published')` at that instant. That path is public
`@byline/client` API, predates this design, and is untouched by it.

The qualification is equally important. An external orchestrator owns scheduling semantics only
while it declines to use Byline's schedule table. Once a Byline schedule exists for a document,
every lifecycle mutation must keep that row consistent — which is what invariant 2 below exists to
guarantee. And the table is independent of the *ticker*, not of *firing*: it carries execution
tokens, lease expiry, retry state, and attempt errors, so any replacement trigger must still go
through the claim-and-fence protocol rather than updating due rows directly. That is precisely why
the sweep is exported as a supported operation.

### Invariants

1. **`changeStatus()` never requires a schedule row to exist, and never uses schedule state to
   authorize or validate publication.** When a row does exist, the lifecycle removes it
   transactionally as consistency cleanup — an effect of publishing, never an input to it.
   Scheduled publishing is optional convenience, never a publication gate. Any future change that
   makes publication depend on schedule state breaks every installation that uses its own
   orchestration, and must be rejected on that basis.
2. **Any lifecycle operation that invalidates an existing schedule clears it transactionally in
   core**, regardless of caller — admin interface, SDK, CLI, HTTP, or MCP. This is a property of
   the lifecycle services, not of any transport. A stale armed row is the failure mode that leaves
   external orchestration with stale lifecycle state and a race against concurrent invalidation.
3. **Schedule operations remain available through `CollectionHandle`.** `schedulePublish`,
   `confirmScheduledPublish`, and `cancelScheduledPublish` are SDK-level, so a future MCP tool or
   HTTP endpoint wraps those services rather than reaching into storage. No transport gets its own
   copy of the rules.
4. **The scheduled-publication sweep is independently callable** as
   `runScheduledPublicationSweep()`, and retains its database-time due checks, per-document claims,
   execution tokens, and lifecycle hooks when invoked that way. An external trigger replaces the
   ticker, not the protocol.
5. **`runDueTasks()` supports external cron orchestration**, so the in-process ticker can be
   disabled entirely. It is a Node function rather than an HTTP endpoint by deliberate choice; a
   first-party `@byline/cli` command wrapping it is named here as a deferred usability bridge, not
   a v1 requirement, unless turnkey external cron becomes one.
6. **The transition primitive's contribution callbacks are not a public extension API.** They are
   an internal seam serving two known callers. Collection hooks remain the supported extension
   point.

### What this section is not

It is not a commitment to ship an HTTP API, an MCP server, a CLI scheduling command, or a queue in
v1. Each of those remains deferred on its own terms. The purpose here is to record that none of
them is *foreclosed* by the decisions in this document, and to name the specific properties that
must survive so they stay possible.

## Tests

### Core unit tests

- Scheduling requires both abilities and a valid direct transition to `published`.
- Stale version, past/invalid instant, single-status workflow, and already-published inputs fail
  with specific domain errors.
- A newer content version suspends the schedule; a status transition from any caller cancels it;
  path and advertised locale changes do neither. (Classification only — that these operations
  *share a transaction* with the schedule write is proved against real adapters, below.)
- A suspended schedule is never claimed, and re-confirmation requires the current version,
  restores `armed`, and preserves the original `publish_at` — including when that instant has
  already passed, which then publishes on the next sweep.
- System execution produces the same hook context, auto-archive behaviour, and audit status action
  as immediate publication.
- One failed item does not stop the remainder of a batch, and a budget-limited run reports
  `workRemaining`.
- `last_authorized_by` is rewritten by create, reschedule, and re-confirm, and is unchanged by
  suspension; deleting that admin account leaves the schedule armed and publishable.
- The cross-collection listing omits schedules in collections for which the viewer lacks either
  ability, and the ability-to-collection-id resolution happens in the service, with the adapter
  receiving only an id allowlist.
- Retry backoff is deterministic, and each terminal outcome is classified correctly:
  a lost workflow transition removes the schedule, a superseded target version suspends it.

### Adapter conformance tests

- Upsert maintains one schedule per document and validates document/version ownership.
- Two simultaneous due claims produce one token winner, and a `needs_reconfirm` row is claimed
  by neither.
- The due-claim index covers the whole predicate: a row in retry backoff is not claimed while
  `next_attempt_at` is in the future, even though `publish_at` has passed.
- Expired claims recover; stale tokens cannot publish, delete, or overwrite errors.
- Cancellation/publication row races have one committed winner.
- Status mutation, auto-archive, status audit, and schedule deletion commit or roll back together
  in one transaction — verified by forcing a failure after the status write and observing that the
  schedule survives and the document remains unpublished.
- Every invalidating lifecycle operation clears an active schedule **in the same transaction**:
  an SDK-driven `changeStatus()`, `unpublishDocument()`, and a soft delete each leave no armed row
  behind, and each rolls the cancellation back with its own failure. These belong here rather than
  in core unit tests: a mocked adapter cannot demonstrate that two writes shared an ambient
  transaction, which is the entire property under test. Both canonical adapters run them.
- Document deletion cascades; content-version creation suspends in its ambient transaction.
- Database time, not process time, controls future validation and due selection.

### Integration and browser verification

- Schedule a reviewed document two minutes ahead; it remains absent publicly, then appears after
  the normal lifecycle hooks run.
- Run two healthy application instances and observe one committed status transition and audit.
- Stop the application across the scheduled time, restart it, and observe catch-up publication.
- Edit after scheduling and confirm suspension plus audit, UI notice, and appearance in the
  awaiting-re-confirmation listing; then re-confirm and observe publication at the original
  instant.
- Cancel close to the due time and verify the UI reports the actual transaction winner.
- Exercise an explicit non-UTC time zone across a daylight-saving boundary.

## Acceptance criteria

1. Under a healthy deployment with one machine kept running, a scheduled document normally
   publishes within a few minutes of its stored instant.
2. Publication always passes through workflow validation, hooks, auto-archive, and audit; no
   scheduler code writes status directly, and no core scheduling code imports `@byline/client`.
3. Two healthy application instances do not produce duplicate committed publication audits.
   Hook delivery retains the existing lifecycle boundary: a `beforeStatusChange` hook may be
   retried after lease loss and an `afterStatusChange` hook can be lost if the process dies after
   commit. Hooks used with scheduled publication must therefore tolerate retries; exactly-once
   external side effects would require a future transactional outbox.
4. Content edits cannot silently retarget a schedule to an unreviewed version, and cannot
   silently discard it either: the schedule survives as a suspended row, is listed as awaiting
   re-confirmation, and publishes at its original instant once confirmed.
5. Missed ticks and application downtime self-heal without a queue or manual replay.
6. Editors can distinguish scheduled, awaiting re-confirmation, overdue/retrying, cancelled, and
   already-published outcomes, both on the document and in the admin listing.
7. Deleting an authorizing account does not stop its pending schedules, and an administrator can
   find every schedule that account authorized from the admin listing alone.
8. Postgres and MySQL satisfy the same schedule and race conformance tests.

## Deferred scope

- Scheduled unpublishing or archival.
- Recurring editorial schedules.
- Approval workflows where one actor schedules and another must approve later.
- Publishing an older pinned version while a newer draft remains current.
- External notifications, webhooks with delivery guarantees, or other work that may justify a
  durable one-off job/queue subsystem.
