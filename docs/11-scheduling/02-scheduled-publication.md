---
title: "Scheduled publication"
path: "scheduled-publication"
summary: "Enable delayed publication, understand what happens when a scheduled document is edited, and know which lifecycle operations suspend or cancel a schedule."
---

# Scheduled publication

Companions:
- [Recurring tasks](./01-recurring-tasks.md) — the scheduler this feature runs on, and the ticker your server entry must start.
- [Client SDK API](../10-api-reference/04-client-sdk.md) — the `CollectionHandle` methods that arm, confirm, and cancel a schedule.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — the two collection abilities a schedule captures.
- [Auditability](../07-auth-and-security/02-auditability.md) — the audit records that make an unattended publication accountable.

Scheduled publication lets an authorized editor choose a future instant at which a specific reviewed document version becomes published. At that instant Byline performs the same workflow status transition as an immediate publish: the same `beforeStatusChange` and `afterStatusChange` hooks and the same auto-archive of previously published versions. The unattended transition runs under a stable system actor, while separate schedule audit records retain the human authorization captured earlier. Read this document when you want to turn the feature on, or when you need to know what happens to a schedule as content changes underneath it.

Scheduled publication is a delayed workflow mutation, not a read filter. Before the instant, the scheduled version is not publicly readable. If the document has an older published version, public reads continue serving that version; a document that has never been published remains excluded. This differs from an embargo, where content is already published and a `beforeRead` predicate hides it until request time — see the embargo recipe in [Authentication and authorization](../07-auth-and-security/01-authn-authz.md). Both remain available; they are not the same mechanism.

Publication is document-grain. The version that publishes carries every locale it was authored with, so scheduling publishes all of a version's locales together. There is no per-locale schedule.

## Enabling it

Three steps, in this order. The schema must exist before a ticker starts, because the scheduler's first sweep reconciles its task rows.

**1. Apply the native upgrade scripts.** Existing installations run both the scheduler table and the schedule table for their adapter. Obtain these source-repository upgrade artifacts from the Git tag for the target Byline release; they are not exported by the adapter npm packages. Apply every script not already applied, in filename order.

The PostgreSQL scripts are idempotent and each runs in one transaction. Run them as the application's database role when possible; their ownership guard also makes running them as a superuser safe. The MySQL scripts are idempotent, but MySQL DDL auto-commits and therefore cannot provide transactional atomicity. Run them as the application role or another account with the required database privileges, and inspect a failed migration before rerunning it because earlier DDL may already have committed.

```sh
# PostgreSQL
psql "$DATABASE_URL" -f packages/db-postgres/sql/0007_add-recurring-tasks.sql
psql "$DATABASE_URL" -f packages/db-postgres/sql/0008_add-document-publish-schedules.sql

# MySQL
mysql "$DATABASE" < packages/db-mysql/sql/0002_add-recurring-tasks.sql
mysql "$DATABASE" < packages/db-mysql/sql/0003_add-document-publish-schedules.sql
```

Installations created by `@byline/cli` receive both tables in the bundled baseline and need neither script.

**2. Enable the feature.**

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
// Optional document-grain delayed publication. This registers the inert
// recurring task; the webapp's server entry starts the ticker explicitly
// so seeds, migrations, and other imports of this config never start one.
scheduledPublication: { enabled: true },
```

This registers the built-in `documents.publish-scheduled` recurring task at a one-minute interval. Registration starts no timer.

**3. Start the ticker** from your server entry, as described in [Recurring tasks](./01-recurring-tasks.md). Without it, schedules are recorded and never fire.

Enablement applies to every collection whose workflow has a valid transition to `published`. Eligibility is then determined per document from its current state and the actor's abilities.

## The editor's states

A schedule is in one of two states, and the admin surfaces four situations:

| Situation | What the editor sees | What they can do |
|---|---|---|
| No schedule, transition valid, actor holds both abilities | **Schedule publication** | Arm a schedule |
| `armed` | **Scheduled for** date, time, zone | Reschedule, cancel |
| `needs_reconfirm` | **Needs re-confirmation** — the content changed after scheduling | Confirm, reschedule, cancel |
| `armed` but overdue and retrying | **Publication overdue** with the last bounded error | Reschedule, cancel |

## Editing suspends rather than cancels

A schedule authorizes one reviewed version. When a content update creates a newer version, the schedule moves to `needs_reconfirm` in the same transaction as that update. A suspended schedule is never claimed and never publishes.

This is deliberate, and it is the design decision most worth understanding. Three behaviours were possible:

- **Publish whatever is current at fire time.** Rejected: it publishes changes made after approval, which defeats the point of scheduling reviewed work.
- **Delete the schedule.** Safe, but its failure mode is silent non-publication. An editor who fixes a typo two days before the instant and does not read the notice gets nothing published at the scheduled time, and no durable record that anything was pending.
- **Suspend the schedule.** Chosen. The safety property is identical to deleting — an `armed` state is reachable only through an explicit authorization command — but the pending intent survives as a durable row. Recovery is one confirmation at the original instant, and the suspended state is enumerable.

That last property is why the admin ships a **scheduled publications queue** rather than relying on a notice in the editor. A dismissed toast is not a durable signal; a list is.

Confirming retargets the schedule to the version the editor has just reviewed and returns it to `armed`, leaving `publishAt` untouched — including when that instant has already passed, in which case it publishes on the next sweep. An editor who wants a different time reschedules instead.

## Which operations suspend, and which cancel

| Operation | Effect on an armed schedule |
|---|---|
| Content update, restore version, copy to locale, delete locale | **Suspend** — these mint a new content version, so the reviewed content changed |
| Status change from any caller, unpublish | **Cancel** — the transition authorized at scheduling time no longer exists |
| Delete a document | **Cancel** — including a soft delete, which leaves the document row in place and so does not cascade |
| Path change, advertised locale change, rescheduling the time | **Neither** — these are unversioned system changes |

Every one of these happens inside the same transaction as the operation that triggered it, so a schedule cannot survive a change that invalidated it, and a rolled-back operation leaves the schedule intact.

"Status change from any caller" means exactly that: the admin interface, the `@byline/client` SDK, a CLI script, or a future transport. The behaviour lives in the lifecycle services, not in any one transport.

## Scheduling from the SDK

**Edit:** wherever you hold a `CollectionHandle`

```ts
const news = client.collection('news')

await news.schedulePublish(documentId, {
  publishAt: '2026-09-01T09:00:00.000Z', // absolute instant, ISO only
  expectedVersionId: currentVersionId, // optimistic guard
})

await news.confirmScheduledPublish(documentId, { expectedVersionId })
await news.cancelScheduledPublish(documentId)
const schedule = await news.getScheduledPublish(documentId)
```

`publishAt` must be an absolute ISO instant in the future, validated against database time. An editor who wants to publish now uses the ordinary publish action. `expectedVersionId` rejects a stale form: an editor cannot schedule a version that changed underneath them.

These are SDK-level operations, so a future MCP tool or HTTP endpoint wraps these services rather than reaching into storage.

## Time zones

The instant is stored in UTC and every due comparison uses database time, so clock skew on an application machine cannot publish early.

The editor picks a wall-clock time against an explicit IANA zone, and the control names that zone beside the field. Times that do not exist or are ambiguous on a daylight-saving boundary are rejected with a specific message rather than silently resolved to one offset — a schedule set for a clock-change night publishes when the editor meant.

## Authorization

Scheduling requires both `collections.<path>.changeStatus` and `collections.<path>.publish` — the same pair an immediate publish requires. Scheduled publication introduces no new role concept, and ordinary `changeStatus()` never requires or consults a schedule row to authorize a publication.

**Authorization is captured when a schedule is armed and is not re-checked at publication time.** Deleting the authorizing account, or revoking its permissions, does not revoke a schedule it validly authorized. The alternative — re-validating at fire time — would let any ordinary permission change silently stop scheduled publications, with nothing connecting cause to effect.

Each schedule records `last_authorized_by`, rewritten whenever the schedule is armed: on create, reschedule, and re-confirm. It answers "whose authorization does this pending publication rest on", which `scheduled_by` cannot once a colleague has re-confirmed someone else's schedule. The queue displays this authorizer for accountability; an authorizer-specific queue filter is not part of the v1 interface.

The queue is filtered per row rather than gated once: a schedule appears only when the viewer holds both abilities for that schedule's own collection. A single page-level check would leak the existence, paths, and timing of scheduled content in collections the viewer cannot otherwise see.

Execution runs under a stable system actor, and the resulting status audit records it as such. Schedule creation, rescheduling, re-confirmation, cancellation, and edit suspension each retain the human actor in their own audit records.

## Delivery guarantees

Publication commits atomically with the removal of its schedule row, so a published document cannot leave behind a schedule that would publish it again.

Hook delivery keeps the existing lifecycle boundary. A `beforeStatusChange` hook may be retried after a lost lease, and an `afterStatusChange` hook can be lost if the process dies after the transaction commits. Hooks used with scheduled publication must tolerate retries. Exactly-once external side effects would require a transactional outbox, which Byline does not ship.

If the application is unavailable at the scheduled instant, the next healthy sweep publishes overdue schedules. A schedule does not expire merely because it is late.

## Not yet shipped

- Scheduled unpublishing or archival.
- Recurring editorial schedules.
- Approval workflows where one actor schedules and another must approve before it fires.
- Publishing an older pinned version while a newer draft remains current.
