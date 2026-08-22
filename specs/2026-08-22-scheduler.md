# Byline recurring-task scheduler — working design

Date: 2026-08-22
Status: working design; not approved for implementation
Companions:

- `specs/2026-08-22-analytics-spec.md` — recurring rollup, retention, and salt-expiry
  consumer.
- `specs/2026-08-22-scheduled-publish.md` — minute-grained scheduled-publication
  consumer.

## Goal

Provide one small, reliable primitive for running recurring, convergent Byline work inside the
normal application process. Every application instance may run a ticker; the database decides
which instance owns each due execution.

The first two consumers are analytics maintenance and scheduled publication. Both are sweeps:
their durable source of truth is normal domain data, a missed run is recovered by a later run,
and rerunning the work is safe when the consumer follows its contract. They do not justify a
queue, an arbitrary job table, a worker service, or a second deployment.

## Non-goals

- Arbitrary one-off jobs with serialized payloads.
- A message queue, worker fleet, dead-letter queue, or workflow engine.
- Exactly-once execution. The scheduler provides leased, at-least-once execution.
- Per-document or per-event task rows. Consumer domain tables remain the work source.
- User-authored cron expressions, second-level precision, task dependencies, or distributed
  transactions across external services.
- Starting timers from `initBylineCore()` or from a server-config side effect.

## Decisions

| Question | Decision |
|---|---|
| Process model | One in-process ticker in every application instance; no separate process or server |
| Cadence | 60-second tick; task intervals cannot be shorter than 60 seconds |
| Multi-instance exclusion | Portable database lease row per recurring task |
| Semantics | At least once; handlers must be idempotent or convergent and catch up domain state |
| Clock | Database UTC time is authoritative for due and lease comparisons |
| Startup | Explicit host action after core initialization; never an `initBylineCore()` side effect |
| Failure recovery | Expiring lease plus small bounded retry backoff |
| Unfinished work | A handler may report work remaining; the runner re-arms the task for the next tick instead of waiting a full interval |
| Long runs | Lease heartbeat and abort signal; task code must cooperate between batches |
| External escape hatch | Export `runDueTasks()` so an external cron can drive the same runner later |
| Adapter parity | Optional scheduler capability on `IDbAdapter`, implemented by canonical Postgres and MySQL adapters and pinned by conformance tests |
| Packaging | A server-only `@byline/core/scheduler` subpath, not a separate publishable package |
| Dedicated scheduler host | Supported as a deployment shape — same image, different entrypoint — not a Byline run mode |

## Packaging

The scheduler ships inside `@byline/core`, with the executable runner behind a server-only
`@byline/core/scheduler` subpath and the inert types and `defineRecurringTask()` helper available
from the main entry. It is not a separate publishable package.

Three things decide this.

**The adapter capability forces the contract into core regardless.** `IDbAdapter.scheduler` is an
optional capability on a core type, and `initBylineCore()` fails at boot when recurring tasks are
registered against an adapter that does not implement it. An interface that the database adapters
implement cannot live in a package downstream of those adapters. A separate scheduler package
would therefore leave the contract in core and export only the runner, splitting one small thing
across two release units for no benefit while adding another entry to the lockstep release set,
another build, another README, and another component the CLI's dependency manifest must know
about.

**A subpath is the established pattern here, not a new one.** Core already exports eight
subpaths, and `@byline/client` separates its server-bound surface exactly this way. Keeping Node
timers off the browser-safe root is a solved problem in this repository.

**A package is the unit of independent substitution, and there is nothing to substitute.** Search
earned its own packages because interchangeable drivers genuinely exist and an installation picks
one; the provider contract still lives in core (`packages/core/src/@types/search-types.ts`) and
only the drivers are packages. The scheduler is the mirror image: it is all contract and no
driver. There will be one implementation — a ticker and a lease — with no dialect-specific code
except the store, which lives in the database adapters where the search stores already live. A
primitive with a single permanent implementation, consumed only by core's own subsystems, is not
a package; it is a core primitive that happens to be new.

Task definitions themselves live with the work they drive, not with the scheduler: the
scheduled-publishing definition sits beside the lifecycle services in core, and the analytics
rollup definition sits in the analytics subsystem. The scheduler owns the contract and the
runner, never the consumers.

### The dedicated scheduler host

Running the scheduler on a machine that serves no requests is a **deployment shape, not a run
mode**, and this design already supports it. Startup is an explicit host action and `runDueTasks()`
is exported, so a dedicated scheduler is the same Docker image with a different entrypoint: boot
core, start the ticker, never bind the HTTP listener. No mode flag, no second package, no new
concept. Recording that here so it is not re-litigated: the question is settled in favour of
"already possible," and nothing in this design needs to change to enable it.

What such a host cannot be is *lighter* than the application, and that is inherent to the work
rather than a consequence of packaging. Publishing a document runs `beforeStatusChange` and
`afterStatusChange`, which are arbitrary application code from the installation's collection
definitions. Any process that publishes must therefore load and execute the full application
graph. Avoiding that would mean not executing the work in the scheduler at all and handing it
elsewhere as a serialized payload — a queue with a transactional outbox, which is deferred scope
for exactly the reasons given at the end of this document. Moving the scheduler into its own
package would not change this by one line.

The choice is genuinely optional because the lease already makes the multi-machine case correct:
running the ticker on every web machine and running it on one dedicated machine produce identical
results, so there is no forcing function to decide either way. The single operational note is
that a deployment which dedicates a machine must simply not call `startBylineScheduler()` on the
web machines — a configuration decision rather than a code change, and harmless to get wrong,
since the lease would serialize the extra tickers anyway.

## Ownership and configuration

Core owns the task definition, validation, runner, and adapter-neutral scheduler-store contract.
The main core entry may export the inert types and `defineRecurringTask()` helper. The executable
runner lives on the server-only `@byline/core/scheduler` subpath so importing browser-safe core
code never pulls in Node timers.

The canonical database adapters own their scheduler schemas, migrations, and store
implementations. `IDbAdapter.scheduler` is optional for third-party adapters; `initBylineCore()`
fails at boot when recurring tasks are configured against an adapter without the capability.

`startBylineScheduler()` is itself framework-agnostic — a timer loop over the core runner — so it
lives in core on the `@byline/core/scheduler` subpath alongside the runner it drives. What the
TanStack Start host owns is not the function but **the responsibility for invoking it**: the
application calls it explicitly from the real server entry after the server config has resolved.
No host adapter reimplements the ticker. This boundary matters because the
same `byline/server.config.ts` is imported by seeds, migrations, and maintenance scripts: those
commands must initialize Byline without acquiring leases or keeping their process alive.

Illustrative configuration:

```ts
const core = await initBylineCore({
  // ...
  recurringTasks: [
    defineScheduledPublishingTask(),
    defineAnalyticsRollupTask({ analytics }),
  ],
})

// In the application server entry only.
const scheduler = startBylineScheduler(core, {
  tickIntervalMs: 60_000,
  startupJitterMs: 30_000,
})
```

Subsystem helpers return ordinary task definitions. Duplicate names, blank names, intervals or
lease durations below 60 seconds, and non-finite durations fail at boot. Registration does not
start execution.

## Task contract

```ts
interface RecurringTaskDefinition {
  /** Stable, globally unique code-owned key, for example `analytics.rollup`. */
  name: string
  /** Delay after a successful run. Minimum 60 seconds. */
  intervalMs: number
  /** Initial lease window. A long-running task renews before this expires. */
  leaseMs: number
  run(context: RecurringTaskContext): Promise<RecurringTaskResult | void>
}

interface RecurringTaskContext {
  taskName: string
  scheduledFor: Date
  signal: AbortSignal
  logger: BylineLogger
  /** Renew the lease. Rejects when the lease has been lost, aborting the run. */
  heartbeat(): Promise<void>
}

interface RecurringTaskResult {
  /**
   * The handler exited with eligible work still outstanding — because it hit a
   * batch budget, not because it failed. The runner schedules the next run
   * immediately rather than after `intervalMs`.
   */
  workRemaining?: boolean
}
```

`heartbeat()` is the only lease interaction a handler needs: it renews the lease and rejects if
the lease has been lost, which aborts the run. There is no separate assertion method, because a
check that does not renew has no caller a rejecting heartbeat does not already serve.

`scheduledFor` is diagnostic context, not a business cursor. A handler determines missing work
from its own durable domain state. Analytics enumerates every unrolled complete UTC day;
scheduled publishing selects every still-due schedule. A task that was offline for an hour runs
once and catches up rather than replaying 60 empty invocations.

Handlers must:

- tolerate another attempt after a crash at any await boundary;
- use domain-level conditional writes or fencing where duplicate side effects would matter;
- process independent records so one poison record does not starve the remainder;
- bound batches, check `signal.aborted` between them, and return `workRemaining: true` when a
  batch budget rather than an empty queue ended the run;
- call `heartbeat()` before the lease's remaining window becomes small;
- avoid keeping raw request data, actor sessions, or other request-scoped state in definitions.

## Durable scheduler state

Logical schema; each adapter selects its native timestamp, integer, and text types:

```text
byline_recurring_tasks
  name                  primary key
  interval_ms           not null
  next_run_at           not null
  lease_token           nullable
  lease_owner           nullable
  lease_expires_at      nullable
  last_started_at       nullable
  last_succeeded_at     nullable
  last_failed_at        nullable
  last_duration_ms      nullable
  consecutive_failures  not null default 0
  last_status           not null
  last_error            nullable
  created_at             not null
  updated_at             not null
```

`last_status` is `never_run | running | succeeded | failed`. `lease_token` is a unique token for
one claim, not a stable machine id. `lease_owner` is a bounded, non-secret diagnostic label such
as a Fly machine id plus process id. Correctness never depends on owner uniqueness.

Task definitions in code are authoritative. On host startup, the store inserts missing rows and
updates `interval_ms` for registered names without replacing health history or a current lease.
Reconciliation must be safe to run concurrently, not merely repeatedly: a deploy restarts every
application instance at once, so several instances reconcile the same names simultaneously. Each
adapter therefore performs reconciliation as a single conflict-tolerant statement per task —
insert-if-absent followed by a bounded conditional update — rather than a read-then-write that
can lose a race or raise a duplicate-key error at boot.
Rows for definitions removed from code are retained as dormant history and are not executed.
They can be pruned through an explicit future maintenance operation; startup never deletes them.

When an interval decreases, reconciliation clamps an unleased `next_run_at` to no later than
database-now plus the new interval; otherwise a former daily cadence could delay a newly
minute-grained task for almost a day. Increasing an interval does not postpone an already due or
earlier scheduled run. The new cadence takes full effect after that run succeeds.

The first `next_run_at` is database-now plus the task interval. A task therefore does not fire at
module evaluation or immediately on every deploy.

## Claim and fencing protocol

For each registered task, the runner attempts one atomic conditional update equivalent to:

```text
if next_run_at <= database_now
and (lease_expires_at is null or lease_expires_at <= database_now):
  lease_token = fresh_token
  lease_owner = this_process
  lease_expires_at = database_now + lease_ms
  last_started_at = database_now
  last_status = running
```

The driver returns the claimed row only when it changed one row. Competing instances affect zero
rows and do nothing. Each adapter uses its native update/return mechanism; core does not depend
on `SKIP LOCKED`, PostgreSQL advisory locks, or MySQL `GET_LOCK`.

Every heartbeat, success, and failure write includes `WHERE lease_token = claimed_token`.
Consequently, a slow runner whose lease expired cannot overwrite a newer run's health or
schedule. A rejected heartbeat aborts that local execution. Fencing the scheduler row cannot
undo arbitrary side effects already emitted by a stale handler, which is why consumer-level
idempotency and conditional domain writes remain mandatory.

On success, the token-matched update:

- records success and duration;
- resets `consecutive_failures` and clears `last_error`;
- clears lease fields; and
- sets `next_run_at = database_now + interval_ms`, or `next_run_at = database_now` when the
  handler reported `workRemaining: true`.

Be precise about what this accelerates, because it is easy to overstate. **Re-arming only helps a
task whose interval is longer than the tick cadence.** A task already running at the 60-second
minimum becomes due on the next tick either way — `database_now` and `database_now + 60_000` land
in the same 60-second tick — so `workRemaining` is a no-op for it, and the acceleration for such
a task comes entirely from its handler's own within-run batch loop. The real beneficiary is a
long-interval task: an hourly catch-up that stops on its execution budget would otherwise wait a
full hour to resume, advancing one unit of work per hour through a backlog that a re-armed task
clears in minutes.

Reporting it is still correct for a minute-grained task — it costs nothing and stays correct if
the interval is ever raised — but no design should claim it as that task's drain mechanism. A
handler that always reported work remaining would pin itself to tick cadence indefinitely, so
this is a statement about an exhausted batch budget, not a general "run me again" request.

On failure, it records the failure, clears the lease, and schedules a bounded retry after 1, 2,
4, 8, then at most 15 minutes. A normal success restores the configured interval. This is a
small failure throttle, not a general retry/job subsystem. Consumer-level item failures may be
logged and left due for the next successful sweep without failing unrelated items.

If the process dies without recording either outcome, another instance can claim the task after
`lease_expires_at` because `next_run_at` remains due.

## Ticker lifecycle

`startBylineScheduler()` waits a random 0–30 seconds, then uses a recursive `setTimeout` rather
than `setInterval`. It never overlaps two local ticks. A tick attempts all registered definitions
and executes successfully claimed, independent tasks with a small fixed concurrency bound so a
slow analytics rollup cannot delay scheduled publication.

The returned controller exposes `stop()`. Shutdown clears the next timeout, aborts active task
signals, and gives active handlers a short grace period. It does not forge successful completion;
unfinished leases expire normally. Tests and development never start a ticker implicitly.

`runDueTasks(core)` performs one identical claim-and-run pass without installing a timer. It is
the supported seam for tests, CLI maintenance, and a future deployment driven by an external
cron. This design does not expose it as an HTTP endpoint or invent remote authentication.

## Operational guarantees and limits

Expected lateness is larger than one tick, and the specifications built on this one should quote
the real figure. Two independent effects compound. First, `next_run_at` advances from completion
rather than from the previous due time, so a task's due instants drift later by roughly the
duration of each run — deliberate, since it prevents a slow task from queueing against itself,
but it is drift. Second, the local ticker's phase is unrelated to that drift, so a task becoming
due one second after a tick waits nearly a full interval before any instance looks at it. For a
one-minute task the practical figures are therefore an average of about ninety seconds and a
normal worst case a little over two minutes, plus run time and contention.

This is an operational target, not a hard real-time guarantee. Event-loop stalls, database
outages, deploys, or a stopped application can make it later; domain catch-up restores the
intended final state when service resumes.

Keeping only the database online is insufficient. An in-process scheduler requires at least one
application machine to remain running. Fly deployments that enable scheduled work must disable
scale-to-zero or configure a minimum of one running machine. Multiple application machines are
expected and require no leader configuration.

At two machines and two one-minute tasks, the conditional claim traffic is operational noise.
No task may hold a dedicated database connection while sleeping between ticks.

Handlers do, however, compete with request traffic for the same connection pool while they run,
and a handler that rebuilds a large unit of work inside one transaction holds both a connection
and an open transaction for its whole duration. On a small deployment pool that is enough to
matter during a catch-up run. Handlers must therefore size a batch to a transaction they are
willing to hold — a single day, a bounded page of rows — and use the `workRemaining` re-arm to
continue, rather than widening the transaction to cover the whole backlog.

## Observability

The scheduler logs structured start, success, failure, lost-lease, and recovered-expired-lease
events with task name, duration, and diagnostic owner. It never stores or logs task arguments
because recurring definitions have none.

`last_error` stores a sanitized message capped at 2 KiB; full stacks go to the configured logger.
The store exposes a read-only health query so an admin diagnostic surface or deployment monitor
can report:

- tasks that have never succeeded;
- `last_succeeded_at` older than a task-specific threshold;
- a currently expired lease;
- consecutive failures and the last bounded error.

A generic scheduler admin page is not required for v1. Analytics may surface a stale-rollup
warning, and scheduled publishing may surface overdue documents, using this health contract.

## Adapter contract and tests

The optional scheduler store supports:

- reconcile registered definitions;
- claim one due definition;
- renew a token-matched lease;
- complete or fail a token-matched lease;
- read health rows;
- return database time as part of claim/health results where needed for deterministic decisions.

Lease expiry makes a row eligible for another claim but does not independently invalidate its
token. A runner may renew after expiry while its token still matches; renewal fails only after a
new claimant has fenced it by replacing that token.

The shared Postgres/MySQL conformance suite pins:

1. Two simultaneous claims produce one winner.
2. A live lease cannot be stolen; an expired lease can.
3. A stale token cannot heartbeat, complete, fail, or overwrite a newer run.
4. Success advances from database time and clears failure state.
5. Failure applies the bounded backoff and a later success resets it.
6. Reconciliation is idempotent, preserves health, and does not delete dormant definitions.
7. Concurrent reconciliation of the same definitions from several instances converges without
   a duplicate-key failure and without losing a registered interval change.
8. A run reporting `workRemaining` becomes due immediately rather than after its interval,
   demonstrated on a task whose interval exceeds the tick cadence; a run without it waits the
   configured interval.
9. Process-clock skew does not change due or expiry decisions.
10. `runDueTasks()` catches errors per task and continues independent definitions.
11. Local ticker ticks never overlap and `stop()` prevents another tick.

## Acceptance criteria

1. One application instance publishes due work within a few minutes under normal operation.
2. Two instances running the same ticker execute one leased task attempt, with the documented
   at-least-once exception after lease loss.
3. Killing a runner mid-task allows recovery after lease expiry without manual database work.
4. Importing server config from a seed or maintenance script starts no timer and does not keep
   the process alive.
5. A three-day outage followed by one tick causes each consumer to discover and catch up its own
   missing domain work, draining at tick cadence rather than one batch per configured interval.
6. Scheduler health makes a silently non-running task distinguishable from a task that ran and
   found no work.
7. Postgres and MySQL pass the same scheduler conformance suite.

## Deferred scope

A later queue or durable one-off job subsystem is not forbidden. It should be introduced only by
a consumer whose work cannot be represented as a convergent sweep — for example, ordered
external delivery with a unique payload and a requirement to preserve every individual attempt.
That subsystem would complement this scheduler rather than expanding `byline_recurring_tasks`
into an unbounded job table.
