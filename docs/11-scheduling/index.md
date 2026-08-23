---
title: "Scheduling"
path: "scheduling"
summary: "How Byline runs recurring background work inside the ordinary application process, and how scheduled publication uses it to publish a reviewed document at a future instant."
---

# Scheduling

Companions:
- [Configuration](../10-api-reference/01-configuration.md) — the `ServerConfig` properties that register recurring tasks and enable scheduled publication.
- [Client SDK API](../10-api-reference/04-client-sdk.md) — scheduling a publication is a `CollectionHandle` operation alongside reads and writes.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — scheduling captures the same collection abilities that an immediate publish requires.
- [Transactions](../03-architecture/03-transactions.md) — the ambient transaction that keeps a publication and its schedule row consistent.
- [Testing](../12-testing.md) — the integration suites that exercise the scheduler against real PostgreSQL and MySQL.

Byline runs recurring background work — publishing a document at a future instant, pruning expired data, or implementing a future analytics rollup — inside the same Node process that serves requests. There is no queue, no worker fleet, and no second deployment to provision. Read this section when you want to enable scheduled publication, register a recurring task of your own, or understand what an installation must keep running for either to work.

Two things ship in this section. The **recurring-task scheduler** is the general primitive: you declare a task, the host starts a ticker, and the database decides which application instance owns each due run. **Scheduled publication** is the first consumer built on it: an editor picks a future instant, and the document moves through Byline's normal workflow transition to `published` when that instant arrives.

## The model

Four terms define the subsystem:

- A **recurring task** is a named function that Byline runs on an interval. It is declared with `defineRecurringTask()` and registered on `ServerConfig`. Registration never starts anything.
- A **sweep** is one execution of a task. Sweeps are *convergent*: a task works out what remains to be done from ordinary domain data, so a missed sweep is recovered by the next one rather than lost.
- A **lease** is the database row that grants one application instance the right to run one task. A lease carries a **fencing token** — a value unique to that claim — so a slow instance whose lease expired cannot write over a newer run's state.
- A **ticker** is the in-process timer that attempts due tasks. Every instance may run one; the lease decides which instance actually executes.

## Why sweeps rather than a queue

Scheduled publication has the shape this scheduler is designed for: its durable source of truth is normal domain data, rerunning it is safe, and a missed run is recovered by a later one. Its task reads the schedule table rather than consuming serialized jobs. Future consumers can use the same model — for example, an analytics rollup could derive pending work from an event table. Work of this kind does not need a serialized payload, a per-item retry policy, a dead-letter queue, or a worker to deliver it.

That shape is what makes an in-process ticker sufficient. Byline deliberately does not ship a queue, and a future one would complement this scheduler rather than replace it — it would exist for work that genuinely cannot be expressed as a convergent sweep, such as ordered external delivery where every individual attempt must be preserved.

## What an installation must run

An in-process ticker requires at least one application instance to stay running. A deployment that scales to zero must either keep a minimum of one instance running or disable the ticker and arrange for an always-on external orchestrator to call `runDueTasks(core)`. Without either execution path, scheduled work never fires.

Multiple instances are expected and need no leader configuration. Every instance may run a ticker; the database lease permits one active claimant for each due task at a time. Execution remains at-least-once because a run interrupted by a crash or an expired lease may be reclaimed and retried.

An installation that would rather drive sweeps from external cron can call `runDueTasks(core)` instead of starting a ticker. It performs one identical reconcile-and-run pass without installing a timer, and it is a supported operational entry point rather than an internal detail.

## Documents in this section

- **[Recurring tasks](./01-recurring-tasks.md)** — declaring a task, starting the ticker, the claim-and-fence protocol, health reporting, and the external-cron path.
- **[Scheduled publication](./02-scheduled-publication.md)** — enabling the feature, the editor-facing state machine, what happens when scheduled content is edited, and the authorization model.
