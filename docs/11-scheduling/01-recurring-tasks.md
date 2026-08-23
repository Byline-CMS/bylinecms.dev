---
title: "Recurring tasks"
path: "recurring-tasks"
summary: "Declare a recurring task, start the in-process ticker from your server entry, and understand the lease and fencing token that make multiple application instances safe."
---

# Recurring tasks

Companions:
- [Scheduling](./index.md) — the model this document implements, and what an installation must keep running.
- [Configuration](../10-api-reference/01-configuration.md) — where `recurringTasks` sits on `ServerConfig`.
- [Scheduled publication](./02-scheduled-publication.md) — the built-in task, and a worked example of a convergent sweep.
- [Testing](../12-testing.md) — the shared conformance suite that both database adapters run against a live server.

A recurring task is a named function Byline runs on an interval inside your application process. You declare it in server configuration, and your server entry starts a ticker that executes due tasks. Reach for this when you have periodic, convergent work — a nightly rollup, a retention prune, a queue drain — that should not require a separate worker deployment.

Registration and execution are deliberately separate. `initBylineCore()` validates and snapshots your task definitions but starts no timer, because the same server configuration is imported by seeds, migrations, and maintenance scripts. Those must not acquire a lease or keep a process alive.

## Requirements

The database adapter must implement the optional scheduler capability. `@byline/db-postgres` and `@byline/db-mysql` both do. `initBylineCore()` fails at boot with an actionable error if tasks are registered against an adapter that does not.

Existing installations must apply the native upgrade script that creates the scheduler's table before starting a ticker — `packages/db-postgres/sql/0007_add-recurring-tasks.sql` or `packages/db-mysql/sql/0002_add-recurring-tasks.sql`. These scripts are source-repository upgrade artifacts rather than npm package exports; obtain them from the Git tag for the target Byline release. The first sweep reconciles task rows and fails loudly against a missing table. Installations created by `@byline/cli` receive the table in the bundled baseline.

## Declaring a task

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import { defineRecurringTask, initBylineCore } from '@byline/core'

const pruneExpiredDrafts = defineRecurringTask({
  name: 'content.prune-expired-drafts',
  intervalMs: 60 * 60_000, // one hour
  leaseMs: 5 * 60_000, // renewed by heartbeat for longer runs
  run: async ({ signal, logger, heartbeat }) => {
    let removed = 0
    for (const batch of await loadExpiredDraftBatches()) {
      if (signal.aborted) break
      await removeBatch(batch)
      removed += batch.length
      await heartbeat()
    }
    logger.info({ removed }, 'pruned expired drafts')
    // Tell the runner more work remains, so the next tick resumes
    // immediately instead of waiting out the full interval.
    return { workRemaining: removed > 0 }
  },
})

await initBylineCore({
  // …
  recurringTasks: [pruneExpiredDrafts],
})
```

`name` must be stable and globally unique — it is the primary key of the task's row. `intervalMs` and `leaseMs` both have a 60-second minimum (`MIN_INTERVAL_MS`, `MIN_LEASE_MS`) and must be whole numbers of milliseconds; a fractional or sub-minimum value fails at boot.

## Writing a handler

A handler must be safe to run again after a crash at any `await`. The runner guarantees at-least-once execution, never exactly-once. In practice that means:

- Derive what remains to be done from durable domain state, not from a cursor the runner passes you. `scheduledFor` is diagnostic context, not a business cursor.
- Bound your batches and check `signal.aborted` between them. The signal aborts on shutdown and on lease loss.
- Call `heartbeat()` before the lease window gets short. It renews the lease and rejects if the lease has been lost, which aborts the run.
- Return `{ workRemaining: true }` when a batch budget rather than an empty queue ended the run.

`workRemaining` re-arms the task for the next tick instead of the full interval. It only accelerates a task whose interval is longer than the tick cadence — a task already at the 60-second minimum becomes due on the next tick either way, and its own within-run batch loop is what drains a backlog.

## Starting the ticker

**Edit:** `apps/webapp/src/server.ts`

The host owns the ticker's lifetime. Start it from the real server entry — never from `initBylineCore()` and never from `byline/server.config.ts`.

```ts
import { getBylineCore } from '@byline/core'
import { type SchedulerController, startBylineScheduler } from '@byline/core/scheduler'

declare global {
  // biome-ignore lint: globalThis augmentation requires `var` rather than `let`
  var __bylineSchedulerController__: SchedulerController | undefined
}

// The host owns ticker lifetime explicitly. Keeping this outside
// `initBylineCore()` and outside `byline/server.config.ts` means importing the
// server config from a seed or migration remains inert. The global survives
// Vite HMR so reloads do not accumulate competing local timers.
globalThis.__bylineSchedulerController__ ??= startBylineScheduler(getBylineCore())
```

The `??=` and the global are load-bearing in development: without them, every Vite hot reload starts an additional ticker in the same process, and the competing timers all claim and fence one another.

`startBylineScheduler` is exported from the server-only `@byline/core/scheduler` subpath. The browser-safe package root exposes only the inert surface — `defineRecurringTask`, `MIN_INTERVAL_MS`, `MIN_LEASE_MS` and the types — so importing core in a client bundle never pulls in Node timers.

### `SchedulerOptions`

| Property | Default | Meaning |
|---|---|---|
| `tickIntervalMs` | `60_000` | How often the ticker looks for due tasks. |
| `startupJitterMs` | `30_000` | Random delay before the first tick, so a deploy restarting every machine does not produce a synchronised tick. |
| `concurrency` | `2` | How many claimed tasks may execute at once, so a slow task cannot delay an unrelated one. |
| `owner` | hostname and pid | Bounded, non-secret diagnostic label. Correctness never depends on it being unique. |
| `shutdownGraceMs` | `5_000` | How long `stop()` waits for an in-flight tick before resolving. |

`startBylineScheduler` returns a `SchedulerController` with a single `stop()` method. `stop()` clears the pending timer, aborts in-flight handlers, waits up to the grace period, and resolves either way. It is idempotent, and it never forges a successful completion — an unfinished lease simply expires and another instance reclaims it.

## How two instances stay safe

Every application instance may run a ticker. Ownership is decided by the database, not by configuration.

Each tick attempts one atomic conditional update per registered task. The update succeeds only when the task is due and either unleased or holding an expired lease. It writes a fresh **fencing token** — a value unique to that claim — and the loser's update affects zero rows and does nothing. Exactly one instance wins.

Every later write is conditional on that token. A slow instance whose lease expired while another instance reclaimed the task cannot renew, complete, or fail the row: the token no longer matches, the write affects zero rows, and the run is abandoned rather than overwriting a newer one's state.

Lease expiry alone does not invalidate a token. A handler that pauses past its deadline may still renew, provided no other claimant has replaced its token — so a garbage-collection pause does not cost a runner its work.

On success, the task's next run is computed from the interval stored on its own row, not from a value the runner supplies. During a rolling deploy an old instance can complete after a new one has reconciled a changed cadence; reading the persisted column means the newly deployed interval always wins.

On failure, the task is rescheduled after a bounded backoff of 1, 2, 4, 8, then at most 15 minutes, and a later success restores the configured interval. This is a small failure throttle, not a general retry subsystem.

## Health

The scheduler records per-task health that an admin surface or a deployment monitor can read: last started, last succeeded, last failed, last duration, consecutive failures, the last bounded error message, and whether a lease is currently expired. Silent non-running is the failure mode that matters most for background work, and this contract is what makes it distinguishable from a task that ran and found nothing to do.

Structured events are logged for start, success, failure, lost lease, and recovered expired lease. Task arguments are never logged, because recurring definitions have none.

## Running sweeps from external cron

An installation that would rather not run a ticker can drive the same pass itself:

```ts
import { getBylineCore } from '@byline/core'
import { runDueTasks } from '@byline/core/scheduler'

const summary = await runDueTasks(getBylineCore())
// { claimed, succeeded, failed, aborted }
```

`runDueTasks` reconciles task definitions and then performs one claim-and-run pass, with no timer installed. It reads the task set from the core instance vetted at boot, so no caller can substitute an unvalidated set. It takes an optional `signal`, `concurrency`, and `owner`.

Reconciliation is part of every pass rather than a ticker-only startup step. A transient reconciliation failure is therefore retried on the next pass instead of leaving the scheduler permanently empty, and it rejects the pass so an external operator observes an outage rather than a silent no-op.

:::warning[Do not wrap a sweep in your own transaction]
Call `runDueTasks` outside any `withTransaction` boundary. Inside one, the database's notion of "now" is frozen at transaction start, and the claim's row lock is held for the whole outer transaction — which convoys every other instance's attempt to claim the same task.
:::

## Not yet shipped

- A generic scheduler admin page. The health contract above is what a future surface would read; scheduled publication ships its own queue in the meantime.
- An HTTP endpoint for `runDueTasks`. It is a Node function by deliberate choice, and no remote authentication has been invented for it.
- A durable one-off job subsystem. Work that cannot be expressed as a convergent sweep — ordered external delivery with a unique payload, where every attempt must be preserved — would justify one, and it would complement this scheduler rather than expand it.
