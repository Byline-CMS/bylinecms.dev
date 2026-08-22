# Recurring-task scheduler implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Byline's recurring-task scheduler — a lease-protected, multi-instance-safe
primitive that runs convergent sweeps inside the ordinary application process — through the
Postgres adapter, with a conformance suite that a later MySQL pass runs unchanged.

**Architecture:** Core owns the task definition, validation, runner, and ticker; the executable
parts sit behind a server-only `@byline/core/scheduler` subpath so the browser-safe root never
pulls in Node timers. Database adapters own the `byline_recurring_tasks` table and implement an
optional `IDbAdapter.scheduler` capability. Every instance may run a ticker; a conditional
`UPDATE` with a fencing token decides which instance owns each due execution.

**Tech Stack:** TypeScript, vitest (`--mode=node` for unit, `--mode=integration` for adapter),
Drizzle ORM + Postgres, Biome, pnpm workspaces.

**Spec:** `specs/2026-08-22-scheduler.md` — read it before starting. This plan implements it; where
they disagree, the spec wins and the plan is wrong.

## Global constraints

Every task's requirements implicitly include these.

- **Minimum interval and lease are 60 seconds each.** `MIN_INTERVAL_MS = 60_000`,
  `MIN_LEASE_MS = 60_000`. Values below these, non-finite values, blank names, and duplicate names
  all fail at boot.
- **Database time is authoritative** for every due and lease-expiry comparison. Never compare
  against `Date.now()` in SQL or in a store implementation. Process clocks may disagree.
- **No timers start from `initBylineCore()`** or from any server-config side effect. The same
  `byline/server.config.ts` is imported by seeds, migrations, and maintenance scripts, and those
  must not acquire leases or keep a process alive. Registration never starts execution.
- **At-least-once, never exactly-once.** Handlers must tolerate another attempt after a crash at
  any await boundary.
- **License header.** Every new source file starts with the MPL header used throughout the repo:
  ```ts
  /**
   * This Source Code is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at http://mozilla.org/MPL/2.0/.
   *
   * Copyright (c) Infonomic Company Limited
   */
  ```
- **Imports use `.js` extensions** on relative paths (NodeNext resolution), even from `.ts` files.
- **Commits use conventional format, past tense, lowercase after the colon**, and MUST be made with
  `git commit -s`. The DCO `Signed-off-by` trailer is the **only** permitted trailer — no
  `Co-Authored-By`, no AI attribution, no others.
- **Biome only.** Run `pnpm lint` from the repo root to auto-fix. Never add ESLint or Prettier.
  2-space indent, single quotes, no semicolons, 100-char lines.
- **The public scheduler API takes `core`, not a dependency bag.** `runDueTasks(core, options?)`
  and `startBylineScheduler(core, options?)` derive the store, the *validated* task definitions,
  and the logger from the `BylineCore` instance. Callers must not be able to pass their own
  `tasks` array: boot validation already vetted the registered set, and a second entry point
  accepting an arbitrary set would let an unvalidated task run. Each has an internal
  dependency-injected sibling (`runDueTasksWithDeps`, `startSchedulerWithDeps`) that unit tests
  target; those are **not** exported from the subpath barrel.
- **Two migration streams, and this plan produces both.** Drizzle is the **development** stream:
  you edit `src/database/schema/index.ts`, run `drizzle:generate`, and work against the generated
  migration. It is not what ships to existing installations. When the adapter's feature work is
  complete, a **hand-written, Drizzle-independent** upgrade script is added to
  `packages/db-postgres/sql/` (and `packages/db-mysql/sql/` when the MySQL pass lands). At release
  time the Drizzle migrations are squashed into the fresh-install baseline bundled by
  `@byline/cli`, the migration key is reset, and the hand-written scripts remain the upgrade path
  for deployed databases. Before that squash, every generated development migration and the
  journal are copied into the CLI's fresh-install bundle so `pnpm test` and new development
  installations see the current schema. The baseline-drift contract accepts one or more files but
  requires the source and bundle inventories, journal entries, and SQL contents to match exactly.
  Read `packages/db-postgres/sql/README.md` before writing one — Task 8 depends on it.
- **Integration tests need Postgres.** `cd postgres && ./postgres.sh up -d`, and a one-time
  `pnpm db:init:test` to create `byline_test`.

## File structure

**Create — `packages/core/src/scheduler/`** (new directory, the whole primitive):

| File | Responsibility |
|---|---|
| `types.ts` | `RecurringTaskDefinition`, `RecurringTaskContext`, `RecurringTaskResult`, `RecurringTaskHealth`, `RecurringTaskStatus`, `ClaimedRecurringTask`, `ISchedulerStore`. Inert — no runtime behaviour. |
| `define-recurring-task.ts` | `defineRecurringTask()` identity helper + `MIN_INTERVAL_MS` / `MIN_LEASE_MS`. |
| `validate-tasks.ts` | `validateRecurringTasks()` — boot-time validation of a definition array. |
| `run-due-tasks.ts` | `runDueTasks()` — one claim-and-run pass over all definitions. No timers. |
| `ticker.ts` | `startBylineScheduler()` — jitter, non-overlapping recursive `setTimeout`, `stop()`. |
| `index.ts` | Server-only barrel for the `@byline/core/scheduler` subpath. |

**Modify:**

- `packages/core/package.json` — add the `./scheduler` export entry.
- `packages/core/src/index.ts` — re-export the inert types and `defineRecurringTask` only.
- `packages/core/src/@types/db-types.ts` — add `scheduler?: ISchedulerStore` to `IDbAdapter`.
- `packages/core/src/core.ts` — boot validation in `initBylineCore()`.
- `packages/db-postgres/src/database/schema/index.ts` — the `byline_recurring_tasks` table.
- `packages/db-conformance/src/index.ts` — export `schedulerSuite`, add the optional hook.
- `packages/db-postgres/tests/conformance.integration.test.ts` — supply the new hook.

**Create — adapter and conformance:**

- `packages/db-postgres/src/modules/scheduler/scheduler-store.ts` — the Postgres store.
- `packages/db-conformance/src/suites/scheduler.ts` — the shared behavioural suite.
- `packages/db-postgres/sql/0007_add-recurring-tasks.sql` — the hand-written, Drizzle-independent
  upgrade script for deployed databases (Task 8, written last).

Tests live beside their source as `*.test.node.ts` in core (vitest node mode); the adapter's
behavioural proof lives entirely in the conformance suite rather than in adapter-local tests.

---

### Task 1: Core types, `defineRecurringTask()`, and validation

Pure and dependency-free. No database, no timers. This task also wires the subpath export so every
later task has somewhere to put executable code.

**Files:**
- Create: `packages/core/src/scheduler/types.ts`
- Create: `packages/core/src/scheduler/define-recurring-task.ts`
- Create: `packages/core/src/scheduler/validate-tasks.ts`
- Create: `packages/core/src/scheduler/index.ts`
- Create: `packages/core/src/scheduler/validate-tasks.test.node.ts`
- Modify: `packages/core/package.json` (exports map)
- Modify: `packages/core/src/index.ts` (re-export inert surface)

**Interfaces:**
- Consumes: nothing.
- Produces: `RecurringTaskDefinition`, `RecurringTaskContext`, `RecurringTaskResult`,
  `RecurringTaskHealth`, `RecurringTaskStatus`, `ClaimedRecurringTask`, `ISchedulerStore`,
  `defineRecurringTask(def: RecurringTaskDefinition): RecurringTaskDefinition`,
  `validateRecurringTasks(defs: readonly RecurringTaskDefinition[]): void`,
  `MIN_INTERVAL_MS: 60_000`, `MIN_LEASE_MS: 60_000`.

- [ ] **Step 1: Write `types.ts`**

```ts
// (MPL header)

import type { BylineLogger } from '../logger/index.js'

/** Lifecycle state of a registered task, as persisted by the store. */
export type RecurringTaskStatus = 'never_run' | 'running' | 'succeeded' | 'failed'

/**
 * What a handler may tell the runner when it returns.
 *
 * `workRemaining` means the handler stopped on a batch budget rather than an
 * empty queue. The runner then sets the next run to database-now instead of
 * database-now plus the interval. This only accelerates a task whose interval
 * exceeds the tick cadence; a task already at the 60s minimum becomes due on
 * the next tick either way.
 */
export interface RecurringTaskResult {
  workRemaining?: boolean
}

/** Everything a handler is given for one execution. */
export interface RecurringTaskContext {
  taskName: string
  /** The `next_run_at` that made this task due. Diagnostic, not a business cursor. */
  scheduledFor: Date
  /** Aborted on shutdown or on lease loss. Handlers check it between batches. */
  signal: AbortSignal
  logger: BylineLogger
  /** Renew the lease. Rejects when the lease has been lost, which aborts the run. */
  heartbeat(): Promise<void>
}

export interface RecurringTaskDefinition {
  /** Stable, code-owned, globally unique key, e.g. `analytics.rollup`. */
  name: string
  /** Delay after a successful run. Minimum 60_000. */
  intervalMs: number
  /** Initial lease window. Minimum 60_000. A long run renews before it expires. */
  leaseMs: number
  run(context: RecurringTaskContext): Promise<RecurringTaskResult | void>
}

/** A task successfully claimed by this instance. */
export interface ClaimedRecurringTask {
  name: string
  /** Unique to this claim. Every later write is conditional on it. */
  leaseToken: string
  scheduledFor: Date
  /** Database time at the moment of the claim. */
  databaseNow: Date
}

/** Read-only health row for diagnostics and admin surfaces. */
export interface RecurringTaskHealth {
  name: string
  intervalMs: number
  nextRunAt: Date
  lastStatus: RecurringTaskStatus
  lastStartedAt: Date | null
  lastSucceededAt: Date | null
  lastFailedAt: Date | null
  lastDurationMs: number | null
  consecutiveFailures: number
  lastError: string | null
  /** True when a lease exists and has passed its expiry — a crashed runner. */
  leaseExpired: boolean
  /** Database time when this row was read, so callers can judge staleness. */
  databaseNow: Date
}

/** What a definition contributes to reconciliation. */
export interface ReconcileTaskInput {
  name: string
  intervalMs: number
}

/**
 * The optional scheduler capability a database adapter implements. Every method
 * derives due-ness and expiry from database time, never from the process clock.
 */
export interface ISchedulerStore {
  /**
   * Insert rows for unknown names and update `interval_ms` for known ones,
   * preserving health history and any live lease. Must be safe to run
   * concurrently from several instances — a deploy restarts them together.
   *
   * When an interval decreases, an unleased `next_run_at` is clamped to no
   * later than database-now plus the new interval.
   */
  reconcile(tasks: readonly ReconcileTaskInput[]): Promise<void>

  /**
   * Atomically claim `name` if it is due and unleased (or its lease expired).
   * Returns null when another instance won or the task is not yet due.
   */
  claim(params: {
    name: string
    leaseMs: number
    owner: string
  }): Promise<ClaimedRecurringTask | null>

  /** Extend a token-matched lease. Returns false when the lease has been lost. */
  renew(params: { name: string; leaseToken: string; leaseMs: number }): Promise<boolean>

  /**
   * Record success on a token-matched row: clear the lease and failure state and
   * set `next_run_at` to database-now plus `intervalMs`, or to database-now when
   * `workRemaining` is true. Returns false when the lease had been lost.
   */
  complete(params: {
    name: string
    leaseToken: string
    intervalMs: number
    durationMs: number
    workRemaining: boolean
  }): Promise<boolean>

  /**
   * Record failure on a token-matched row: clear the lease, increment
   * `consecutive_failures`, store a bounded error, and schedule the bounded
   * retry backoff. Returns false when the lease had been lost.
   */
  fail(params: {
    name: string
    leaseToken: string
    durationMs: number
    error: string
  }): Promise<boolean>

  /** Health rows for the named tasks, or all rows when `names` is omitted. */
  health(names?: readonly string[]): Promise<RecurringTaskHealth[]>
}
```

- [ ] **Step 2: Write `define-recurring-task.ts`**

```ts
// (MPL header)

import type { RecurringTaskDefinition } from './types.js'

/** Shortest permitted interval between runs, and shortest permitted lease. */
export const MIN_INTERVAL_MS = 60_000
export const MIN_LEASE_MS = 60_000

/** Maximum bounded retry delay after repeated failures. */
export const MAX_BACKOFF_MS = 15 * 60_000

/**
 * Identity helper that gives a task definition its type without starting
 * anything. Registration is not execution: timers begin only when the host
 * calls `startBylineScheduler()`.
 */
export function defineRecurringTask(definition: RecurringTaskDefinition): RecurringTaskDefinition {
  return definition
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/core/src/scheduler/validate-tasks.test.node.ts`:

```ts
// (MPL header)

import { describe, expect, it } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { validateRecurringTasks } from './validate-tasks.js'

const ok = defineRecurringTask({
  name: 'analytics.rollup',
  intervalMs: 3_600_000,
  leaseMs: 300_000,
  run: async () => {},
})

describe('validateRecurringTasks', () => {
  it('accepts a valid set', () => {
    expect(() => validateRecurringTasks([ok])).not.toThrow()
  })

  it('accepts an empty set', () => {
    expect(() => validateRecurringTasks([])).not.toThrow()
  })

  it('rejects duplicate names', () => {
    expect(() => validateRecurringTasks([ok, { ...ok }])).toThrow(/duplicate/i)
  })

  it('rejects a blank name', () => {
    expect(() => validateRecurringTasks([{ ...ok, name: '   ' }])).toThrow(/name/i)
  })

  it('rejects an interval below the 60s minimum', () => {
    expect(() => validateRecurringTasks([{ ...ok, intervalMs: 59_999 }])).toThrow(/interval/i)
  })

  it('rejects a lease below the 60s minimum', () => {
    expect(() => validateRecurringTasks([{ ...ok, leaseMs: 59_999 }])).toThrow(/lease/i)
  })

  it('rejects non-finite durations', () => {
    expect(() => validateRecurringTasks([{ ...ok, intervalMs: Number.NaN }])).toThrow(/interval/i)
    expect(() =>
      validateRecurringTasks([{ ...ok, leaseMs: Number.POSITIVE_INFINITY }])
    ).toThrow(/lease/i)
  })

  it('rejects a missing run function', () => {
    expect(() =>
      validateRecurringTasks([{ ...ok, run: undefined as never }])
    ).toThrow(/run/i)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/validate-tasks.test.node.ts`
Expected: FAIL — cannot resolve `./validate-tasks.js`.

- [ ] **Step 5: Write `validate-tasks.ts`**

```ts
// (MPL header)

import { MIN_INTERVAL_MS, MIN_LEASE_MS } from './define-recurring-task.js'
import type { RecurringTaskDefinition } from './types.js'

function assertDuration(value: number, label: string, minimum: number, taskName: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `recurring task '${taskName}': ${label} must be a finite number of milliseconds`
    )
  }
  if (value < minimum) {
    throw new Error(
      `recurring task '${taskName}': ${label} must be at least ${minimum}ms (received ${value})`
    )
  }
}

/**
 * Boot-time validation of the registered task set. Throws on the first problem
 * so a misconfigured deployment fails loudly at startup rather than silently
 * never running work.
 */
export function validateRecurringTasks(definitions: readonly RecurringTaskDefinition[]): void {
  const seen = new Set<string>()

  for (const definition of definitions) {
    const name = definition?.name
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('recurring task: name must be a non-empty string')
    }
    if (seen.has(name)) {
      throw new Error(`recurring task '${name}': duplicate task name`)
    }
    seen.add(name)

    assertDuration(definition.intervalMs, 'intervalMs', MIN_INTERVAL_MS, name)
    assertDuration(definition.leaseMs, 'leaseMs', MIN_LEASE_MS, name)

    if (typeof definition.run !== 'function') {
      throw new Error(`recurring task '${name}': run must be a function`)
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/validate-tasks.test.node.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Create the subpath barrel**

Create `packages/core/src/scheduler/index.ts`:

```ts
// (MPL header)

/**
 * `@byline/core/scheduler` — the server-only executable surface of the
 * recurring-task scheduler. The inert types and `defineRecurringTask()` are
 * also re-exported from the package root; the runner and ticker are here so
 * importing browser-safe core code never pulls in Node timers.
 */

export {
  MAX_BACKOFF_MS,
  MIN_INTERVAL_MS,
  MIN_LEASE_MS,
  defineRecurringTask,
} from './define-recurring-task.js'
export type {
  ClaimedRecurringTask,
  ISchedulerStore,
  ReconcileTaskInput,
  RecurringTaskContext,
  RecurringTaskDefinition,
  RecurringTaskHealth,
  RecurringTaskResult,
  RecurringTaskStatus,
} from './types.js'
export { validateRecurringTasks } from './validate-tasks.js'
```

- [ ] **Step 8: Add the export entry to `packages/core/package.json`**

Insert after the `"./workflow"` entry, matching its shape exactly:

```json
    "./scheduler": {
      "types": "./dist/scheduler/index.d.ts",
      "import": "./dist/scheduler/index.js",
      "require": "./dist/scheduler/index.js"
    },
```

- [ ] **Step 9: Re-export the inert surface from the core root**

In `packages/core/src/index.ts`, add alongside the other subsystem re-exports:

```ts
export { defineRecurringTask, MIN_INTERVAL_MS, MIN_LEASE_MS } from './scheduler/define-recurring-task.js'
export type {
  ClaimedRecurringTask,
  ISchedulerStore,
  ReconcileTaskInput,
  RecurringTaskContext,
  RecurringTaskDefinition,
  RecurringTaskHealth,
  RecurringTaskResult,
  RecurringTaskStatus,
} from './scheduler/types.js'
```

Do **not** re-export `runDueTasks` or `startBylineScheduler` from the root in any later task.

- [ ] **Step 10: Verify the build and types**

Run: `cd packages/core && pnpm build && pnpm typecheck`
Expected: both succeed; `packages/core/dist/scheduler/index.js` exists.

- [ ] **Step 11: Lint and commit**

```bash
pnpm lint
git add packages/core/src/scheduler packages/core/src/index.ts packages/core/package.json
git commit -s -m "feat(scheduler): added recurring-task types, definition helper, and validation"
```

---

### Task 2: Adapter capability and boot validation

**Files:**
- Modify: `packages/core/src/@types/db-types.ts` (add `scheduler?` to `IDbAdapter`)
- Modify: `packages/core/src/core.ts` (`initBylineCore()` validation)
- Create: `packages/core/src/scheduler/validate-scheduler-config.test.node.ts`
- Create: `packages/core/src/scheduler/validate-scheduler-config.ts`

**Interfaces:**
- Consumes: `validateRecurringTasks`, `ISchedulerStore`, `RecurringTaskDefinition` (Task 1).
- Produces: `validateSchedulerConfig(params: { tasks?: readonly RecurringTaskDefinition[]; adapter: Pick<IDbAdapter, 'scheduler'> }): void`;
  `IDbAdapter.scheduler?: ISchedulerStore`; `ServerConfig.recurringTasks?: RecurringTaskDefinition[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/scheduler/validate-scheduler-config.test.node.ts`:

```ts
// (MPL header)

import { describe, expect, it } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { validateSchedulerConfig } from './validate-scheduler-config.js'
import type { ISchedulerStore } from './types.js'

const task = defineRecurringTask({
  name: 'analytics.rollup',
  intervalMs: 3_600_000,
  leaseMs: 300_000,
  run: async () => {},
})

const store = {} as ISchedulerStore

describe('validateSchedulerConfig', () => {
  it('passes when tasks are registered against a scheduler-capable adapter', () => {
    expect(() =>
      validateSchedulerConfig({ tasks: [task], adapter: { scheduler: store } })
    ).not.toThrow()
  })

  it('passes when no tasks are registered and the adapter lacks the capability', () => {
    expect(() => validateSchedulerConfig({ tasks: [], adapter: {} })).not.toThrow()
    expect(() => validateSchedulerConfig({ adapter: {} })).not.toThrow()
  })

  it('fails when tasks are registered against an adapter without the capability', () => {
    expect(() => validateSchedulerConfig({ tasks: [task], adapter: {} })).toThrow(
      /scheduler/i
    )
  })

  it('names the offending tasks in the failure message', () => {
    expect(() => validateSchedulerConfig({ tasks: [task], adapter: {} })).toThrow(
      /analytics\.rollup/
    )
  })

  it('applies task validation as part of config validation', () => {
    expect(() =>
      validateSchedulerConfig({
        tasks: [{ ...task, intervalMs: 1_000 }],
        adapter: { scheduler: store },
      })
    ).toThrow(/interval/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/validate-scheduler-config.test.node.ts`
Expected: FAIL — cannot resolve `./validate-scheduler-config.js`.

- [ ] **Step 3: Write `validate-scheduler-config.ts`**

```ts
// (MPL header)

import type { ISchedulerStore, RecurringTaskDefinition } from './types.js'
import { validateRecurringTasks } from './validate-tasks.js'

/**
 * Boot-time gate. Recurring tasks registered against an adapter that does not
 * implement the optional scheduler capability would silently never run, so this
 * fails loudly at `initBylineCore()` instead.
 */
export function validateSchedulerConfig(params: {
  tasks?: readonly RecurringTaskDefinition[]
  adapter: { scheduler?: ISchedulerStore }
}): void {
  const tasks = params.tasks ?? []
  if (tasks.length === 0) return

  validateRecurringTasks(tasks)

  if (params.adapter.scheduler == null) {
    const names = tasks.map((t) => t.name).join(', ')
    throw new Error(
      `recurring tasks are registered (${names}) but the configured database adapter does not ` +
        'implement the scheduler capability. Use a canonical adapter (@byline/db-postgres or ' +
        '@byline/db-mysql), or remove the tasks.'
    )
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/validate-scheduler-config.test.node.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the capability to `IDbAdapter`**

In `packages/core/src/@types/db-types.ts`, add to the `IDbAdapter` interface immediately after
`classifyError?`, and add the type import at the top of the file:

```ts
  /**
   * Optional recurring-task scheduler storage. Present on the canonical
   * adapters; absent adapters simply cannot run recurring tasks, which
   * `initBylineCore()` reports at boot rather than failing silently later.
   * See specs/2026-08-22-scheduler.md.
   */
  scheduler?: ISchedulerStore
```

- [ ] **Step 6: Call the gate from `initBylineCore()`**

In `packages/core/src/core.ts`, add `recurringTasks?: RecurringTaskDefinition[]` to the server
config type, and call the gate alongside the existing boot validators (next to
`validateSearchConfig`):

```ts
validateSchedulerConfig({ tasks: config.recurringTasks, adapter: db })
```

Registration stores the **validated** definitions on the returned `BylineCore` instance as
`core.recurringTasks: readonly RecurringTaskDefinition[]` (an empty array when none are
configured), so `runDueTasks(core)` and `startBylineScheduler(core)` read the vetted set and no
caller can substitute another. It must **not** start a timer here — see the global constraints.

- [ ] **Step 7: Verify the whole core package still builds and passes**

Run: `cd packages/core && pnpm typecheck && pnpm test`
Expected: typecheck clean; full core suite green.

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add packages/core/src
git commit -s -m "feat(scheduler): added the optional adapter capability and boot validation"
```

---

### Task 3: Postgres schema for `byline_recurring_tasks` (development stream)

This task produces the **Drizzle** schema and generated migration, which is what development and
the test database run against. It is not the artifact that upgrades a deployed installation — that
is Task 8, written once the adapter work is proven.

**Files:**
- Modify: `packages/db-postgres/src/database/schema/index.ts`
- Create: a generated migration under `packages/db-postgres/src/database/migrations/`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure schema).
- Produces: the `recurringTasks` Drizzle table export, used by Task 4.

- [ ] **Step 1: Add the table to the schema**

Append to `packages/db-postgres/src/database/schema/index.ts`, following the style of the
surrounding tables (`timestamps` spread last):

```ts
// Recurring-task scheduler (specs/2026-08-22-scheduler.md).
// Code-registered definitions are authoritative; rows for definitions removed
// from code are retained as dormant history and never executed.
export const recurringTasks = pgTable('byline_recurring_tasks', {
  name: varchar('name', { length: 255 }).primaryKey(),
  interval_ms: integer('interval_ms').notNull(),
  next_run_at: timestamp('next_run_at', { withTimezone: true }).notNull(),
  // A token unique to one claim — not a stable machine id. Every health and
  // schedule write is conditional on it, so a slow runner whose lease expired
  // cannot overwrite a newer run.
  lease_token: uuid('lease_token'),
  // Bounded, non-secret diagnostic label (machine id + pid). Correctness never
  // depends on owner uniqueness.
  lease_owner: varchar('lease_owner', { length: 255 }),
  lease_expires_at: timestamp('lease_expires_at', { withTimezone: true }),
  last_started_at: timestamp('last_started_at', { withTimezone: true }),
  last_succeeded_at: timestamp('last_succeeded_at', { withTimezone: true }),
  last_failed_at: timestamp('last_failed_at', { withTimezone: true }),
  last_duration_ms: integer('last_duration_ms'),
  consecutive_failures: integer('consecutive_failures').notNull().default(0),
  last_status: varchar('last_status', { length: 32 }).notNull().default('never_run'),
  // Sanitized message, capped at 2 KiB by the store. Full stacks go to the logger.
  last_error: text('last_error'),
  ...timestamps,
})
```

- [ ] **Step 2: Generate the migration**

Run: `cd packages/db-postgres && pnpm drizzle:generate`
Expected: a new numbered `.sql` file appears in `src/database/migrations/` containing
`CREATE TABLE "byline_recurring_tasks"`.

- [ ] **Step 3: Inspect the generated SQL**

Run: `cat packages/db-postgres/src/database/migrations/*.sql | tail -30`
Expected: the new table with `name` as primary key, `interval_ms` and `next_run_at` NOT NULL,
`consecutive_failures` defaulting to 0, `last_status` defaulting to `'never_run'`. If the
generator produced anything else — a dropped column elsewhere, an unrelated diff — stop and report
rather than editing the migration by hand.

- [ ] **Step 4: Synchronize the CLI fresh-install bundle**

Copy every new generated SQL migration plus `meta/_journal.json` into
`packages/cli/src/templates/migrations/postgres/`. Do not copy Drizzle snapshots; the runtime
migrator consumes the SQL files and journal. Run:

```bash
cd packages/cli
pnpm vitest run src/lib/baseline-drift.test.ts
```

Expected: the Postgres and MySQL bundles both match their adapter source inventories. During
feature development the Postgres bundle may contain multiple migrations; the release squash later
reduces it to one without weakening this exact-inventory guard.

- [ ] **Step 5: Apply it to the test database**

```bash
cd postgres && ./postgres.sh up -d
cd ../packages/db-postgres && pnpm drizzle:migrate
```
Expected: migration applies without error.

- [ ] **Step 6: Commit**

```bash
pnpm lint
git add packages/db-postgres/src/database packages/cli/src/templates/migrations/postgres \
  packages/cli/src/lib/baseline.ts packages/cli/src/lib/baseline-drift.test.ts
git commit -s -m "feat(scheduler): added the byline_recurring_tasks table to the postgres adapter"
```

Do **not** write anything into `packages/db-postgres/sql/` yet. That script is written against the
finished, conformance-proven schema, so that it never has to be amended — see Task 8.

---

### Task 4: Postgres scheduler store

The claim/fencing protocol. Every statement derives time from the database via `now()`.

**Files:**
- Create: `packages/db-postgres/src/modules/scheduler/scheduler-store.ts`
- Modify: `packages/db-postgres/src/index.ts` (attach `scheduler` to the adapter)

**Note — two coercion traps, both confirmed in production code.** `db.execute` does not give you
the driver's normal type parsing:

1. `interval_ms` and `last_duration_ms` are `bigint`. The `pg` driver returns bigint as a
**string** by default. The store must coerce to `number` on read (values are guaranteed safe
integers by boot validation) so `RecurringTaskHealth.intervalMs` and `lastDurationMs` are numbers,
not strings.

2. **Timestamps come back as strings too, and this one is counter-intuitive.**
`drizzle-orm/node-postgres/session.js` overrides `getTypeParser` for `TIMESTAMPTZ`, `TIMESTAMP`,
`DATE`, and `INTERVAL` with an identity function on the `rawQueryConfig` that `db.execute` uses.
So a `timestamptz` column does **not** arrive as a `Date` — it arrives as ISO text. Every `Date`
field the contract declares (`ClaimedRecurringTask.scheduledFor`, `.databaseNow`, and
`RecurringTaskHealth.nextRunAt`, `.lastStartedAt`, `.lastSucceededAt`, `.lastFailedAt`,
`.databaseNow`) must be coerced at the method boundary, and the row types should be declared as
`string` so TypeScript models reality rather than the assumption.

This one shipped past three separate static reviews — one of which explicitly reasoned that
"timestamps are `timestamptz` → `Date` natively", which is true for the query builder and false
for `db.execute`. Only the live conformance suite caught it. A second adapter implementing this
interface should expect the same trap in whatever driver it uses, and the conformance suite now
asserts `toBeInstanceOf(Date)` so it cannot recur silently.

**Interfaces:**
- Consumes: `ISchedulerStore`, `ClaimedRecurringTask`, `RecurringTaskHealth`, `ReconcileTaskInput`,
  `MAX_BACKOFF_MS` (Tasks 1–2); the `recurringTasks` table (Task 3).
- Produces: `createSchedulerStore(db: PostgresDb): ISchedulerStore`, attached as
  `IDbAdapter.scheduler`.

- [ ] **Step 1: Write the store**

Create `packages/db-postgres/src/modules/scheduler/scheduler-store.ts`. Follow the module style of
`packages/db-postgres/src/modules/counters/counters-commands.ts` for how the db handle is taken and
raw SQL is issued.

Required behaviour, statement by statement:

**`reconcile(tasks)`** — one conflict-tolerant statement per task, never read-then-write:

```sql
INSERT INTO byline_recurring_tasks (name, interval_ms, next_run_at, last_status)
VALUES ($1, $2, now() + make_interval(secs => $2 / 1000.0), 'never_run')
ON CONFLICT (name) DO UPDATE SET
  interval_ms = EXCLUDED.interval_ms,
  next_run_at = CASE
    WHEN byline_recurring_tasks.lease_token IS NULL
     AND byline_recurring_tasks.next_run_at > now() + make_interval(secs => $2 / 1000.0)
    THEN now() + make_interval(secs => $2 / 1000.0)
    ELSE byline_recurring_tasks.next_run_at
  END,
  updated_at = now()
```

The `CASE` is the interval-decrease clamp: an unleased task whose next run is further out than the
new interval is pulled in, so lowering a daily cadence to a minute does not wait most of a day. An
increase never postpones an already-due run. A live lease is never disturbed.

**`claim({ name, leaseMs, owner })`** — one atomic conditional update:

```sql
UPDATE byline_recurring_tasks SET
  lease_token = gen_random_uuid(),
  lease_owner = $3,
  lease_expires_at = now() + make_interval(secs => $2 / 1000.0),
  last_started_at = now(),
  last_status = 'running',
  updated_at = now()
WHERE name = $1
  AND next_run_at <= now()
  AND (lease_expires_at IS NULL OR lease_expires_at <= now())
RETURNING name, lease_token, next_run_at AS scheduled_for, now() AS database_now
```

The claim must also report **`recoveredExpiredLease`** — true when it took over a lease that had
expired (a previous runner died mid-execution), false when it claimed an unleased row. The runner
logs a distinct `recovered-expired-lease` event for the former. Capture it in the same statement
rather than with a second read: add `(lease_expires_at IS NOT NULL) AS recovered_expired_lease` to
the `RETURNING` list — because `lease_expires_at` is in the SET list, `RETURNING` on it would give
the NEW value, so read it via an expression evaluated against the old row, or restructure as an
`UPDATE ... FROM (SELECT ...)` if the driver makes that cleaner. Whichever form is used, the
returned flag must describe the row's state **before** this claim.

Return `null` when zero rows changed. Competing instances affect zero rows and do nothing. Note
`scheduled_for` is the pre-update `next_run_at`, which Postgres `RETURNING` gives from the old row
only if selected before assignment — since `next_run_at` is not in the SET list, `RETURNING
next_run_at` is the unchanged value and is correct here.

**`renew({ name, leaseToken, leaseMs })`** — token-matched, returns `rowCount === 1`. Do not add an
expiry predicate: expiry makes a row claimable but does not invalidate the current token by itself.
A runner that resumes after its deadline may still renew provided another claimant has not replaced
that token.

**All three token-matched writes compare `lease_token::text`, never the bare column.**
`lease_token` is a `uuid` column, so `lease_token = $2` makes Postgres parse the bound string as a
UUID *before* comparing — a malformed token then raises `22P02` instead of matching zero rows,
violating the contract's "returns `false`, never throws". Casting to text costs nothing here
because the predicate is already anchored on `name`, the primary key. MySQL's `char(36)` has no
such problem, which is exactly why a conformance test written once would pass there and throw
here.

```sql
UPDATE byline_recurring_tasks
SET lease_expires_at = now() + make_interval(secs => $3 / 1000.0), updated_at = now()
WHERE name = $1 AND lease_token::text = $2
```

**`complete({ name, leaseToken, durationMs, workRemaining })`** — token-matched. Note there is
**no `intervalMs` parameter**: `next_run_at` derives from the row's own persisted `interval_ms`,
so a runner holding a lease across a rolling deploy cannot write a stale cadence over a newly
reconciled one.

```sql
UPDATE byline_recurring_tasks SET
  last_succeeded_at = now(),
  last_status = 'succeeded',
  last_duration_ms = $3,
  consecutive_failures = 0,
  last_error = NULL,
  lease_token = NULL,
  lease_owner = NULL,
  lease_expires_at = NULL,
  next_run_at = CASE WHEN $4 THEN now()
                     ELSE now() + make_interval(secs => interval_ms / 1000.0) END,
  updated_at = now()
WHERE name = $1 AND lease_token::text = $2
```

Bindings are `$1` name, `$2` leaseToken, `$3` durationMs, `$4` workRemaining. Watch the numbering:
an earlier revision of this plan carried `intervalMs` as `$3`, and removing it without renumbering
left `$4` bound to both the duration and the boolean — which fails at runtime on every successful
completion.

`interval_ms` in the `CASE` is the row's own column — Postgres evaluates SET expressions against
the OLD row, so this is the persisted cadence, which is exactly the intent.

**`fail({ name, leaseToken, durationMs, error })`** — token-matched, with the bounded backoff of
1, 2, 4, 8, then at most 15 minutes, computed from the incremented failure count:

```sql
UPDATE byline_recurring_tasks SET
  last_failed_at = now(),
  last_status = 'failed',
  last_duration_ms = $3,
  consecutive_failures = consecutive_failures + 1,
  last_error = $4,
  lease_token = NULL,
  lease_owner = NULL,
  lease_expires_at = NULL,
  next_run_at = now() + make_interval(secs => LEAST(
    60 * power(2, LEAST(consecutive_failures, 4))::int,
    900
  )),
  updated_at = now()
WHERE name = $1 AND lease_token::text = $2
```

Truncate `error` to 2048 characters before binding it. Never bind a stack trace.

**`health(names?)`** — a read returning every column plus computed staleness:

```sql
SELECT name, interval_ms, next_run_at, last_status, last_started_at, last_succeeded_at,
       last_failed_at, last_duration_ms, consecutive_failures, last_error,
       (lease_expires_at IS NOT NULL AND lease_expires_at <= now()) AS lease_expired,
       now() AS database_now
FROM byline_recurring_tasks
WHERE ($1::text[] IS NULL OR name = ANY($1))
ORDER BY name
```

**Bind the name list with `sql.param(nameList)`, not a bare `${nameList}`.** Drizzle's `sql` tag
tests `Array.isArray` before its `Param` branch and expands a bare array into a parenthesised row
constructor, so only the no-argument path works: one name yields `22P02 malformed array literal`,
several yields `42846 cannot cast type record to text[]`, and an empty array is a syntax error.
The same trap is already documented in this package at
`packages/db-postgres/src/modules/storage/storage-queries.ts:2377` — the other `= ANY` call sites
avoid it. Wrap **both** occurrences:

```ts
WHERE (${sql.param(nameList)}::text[] IS NULL OR name = ANY(${sql.param(nameList)}))
```

- [ ] **Step 2: Attach it to the adapter**

In `packages/db-postgres/src/index.ts`, add `scheduler: createSchedulerStore(db)` to the returned
adapter object, alongside `classifyError` and the command/query groups.

- [ ] **Step 3: Verify types and build**

Run: `cd packages/db-postgres && pnpm typecheck && pnpm build`
Expected: both clean. The store must structurally satisfy `ISchedulerStore` with no casts.

- [ ] **Step 4: Commit**

```bash
pnpm lint
git add packages/db-postgres/src
git commit -s -m "feat(scheduler): added the postgres scheduler store with lease fencing"
```

Behaviour is proved in Task 5, not here — the conformance suite is the gate.

---

### Task 5: Shared conformance suite

The twelve behaviours the spec pins. This suite is the artifact that makes the later MySQL pass
mechanical, so it must talk only to `ISchedulerStore` — never to Drizzle, `pg`, or any
adapter-internal handle.

**Files:**
- Create: `packages/db-conformance/src/suites/scheduler.ts`
- Modify: `packages/db-conformance/src/index.ts` (export the suite, add the optional hook)
- Modify: `packages/db-postgres/tests/conformance.integration.test.ts` (supply the hook)

**Interfaces:**
- Consumes: `ISchedulerStore` (Task 1); the Postgres store (Task 4).
- Produces: `schedulerSuite(hooks: ConformanceHooks): void`;
  `ConformanceHooks.createSchedulerStore?(): Promise<ISchedulerStore>`;
  `ConformanceHooks.observeSchedulerContention?` for adapter-owned physical-connection
  instrumentation during the two race tests.

- [ ] **Step 1: Add the optional hook**

In `packages/db-conformance/src/index.ts`, add to `ConformanceHooks`, mirroring the
`createAdminStore?` comment style:

```ts
  /**
   * Construct the adapter's `ISchedulerStore` against the same test database.
   * Optional — an adapter without scheduler support omits it and the scheduler
   * suite is not registered at all, so it never appears as skipped.
   * An adapter that supplies this hook must also supply
   * `observeSchedulerContention` below.
   */
  createSchedulerStore?(): Promise<ISchedulerStore>

  /**
   * Run `operation` while observing the adapter's physical connection
   * lifecycle. The scheduler race tests require a peak greater than one so a
   * one-connection pool cannot turn them into silently serialized non-tests.
   */
  observeSchedulerContention?: <T>(
    operation: () => Promise<T>
  ) => Promise<{ result: T; maxConcurrentConnections: number }>
```

Export the suite alongside the others: `export { schedulerSuite } from './suites/scheduler.js'`.
In `runAdapterConformanceSuite`, register it only when the hook is present, the same way
`createAdminStore` gates the admin-store suites.

- [ ] **Step 2: Write the suite**

Create `packages/db-conformance/src/suites/scheduler.ts`. Structure it as one top-level `describe`
whose `beforeAll` calls `hooks.truncate()` then `hooks.createSchedulerStore!()` and rejects a
scheduler-capable hook that omitted `observeSchedulerContention`. Each test reconciles the
definitions it needs with a unique name prefix so tests do not collide.

The twelve behaviours, one `it` each:

1. **Two simultaneous claims produce one winner.** Reconcile a task with a 60s interval, force it
   due, then make several claims through `observeSchedulerContention`. Exactly one result is
   non-null and `maxConcurrentConnections` is greater than one; the latter assertion is what makes
   this a database-contention test rather than a test of sequential calls through one connection.
2. **A live lease cannot be stolen; an expired lease can.** Claim with a long lease, assert a
   second claim returns null. Then claim with the shortest lease the store permits, wait past
   expiry, assert a further claim succeeds and returns a *different* `leaseToken`. Also prove that
   `renew` has an effect rather than merely returning `true`: renew a short lease before it expires,
   wait beyond the original expiry but within the renewed window, and assert a competing claim is
   still excluded. Finally, let another short lease expire without reclaiming it and assert its
   still-matching token can renew successfully; expiry makes the row claimable, but only a new
   token fences the old runner.
3. **A stale token cannot heartbeat, complete, fail, or overwrite a newer run.** Claim (token A),
   let it expire, re-claim (token B), then assert `renew`, `complete`, and `fail` with token A all
   return `false` and leave the token-B row unchanged.
4. **Success advances from database time and clears failure state.** Fail once with a distinctive
   duration and an error longer than 2048 characters; immediately assert `last_status`,
   `last_duration_ms`, `last_failed_at`, and the truncated error. Then claim and complete; assert
   `consecutive_failures` is 0, `last_error` is null, `last_status` is `'succeeded'`, and
   `next_run_at` is approximately `databaseNow + intervalMs`.
5. **Failure applies the bounded backoff and a later success resets it.** Fail three times in
   succession, asserting `next_run_at` advances by roughly 1, then 2, then 4 minutes, and that the
   delay never exceeds 15 minutes however many failures accumulate. Then succeed and assert the
   configured interval is restored.
6. **Reconciliation is idempotent, preserves health, and does not delete dormant definitions.**
   Reconcile, complete a run, reconcile again with the same input; assert `last_succeeded_at`
   survives. Reconcile a *smaller* set; assert the omitted task's row still exists and is
   unchanged.
7. **Concurrent reconciliation converges.** Run five identical `reconcile` calls through
   `observeSchedulerContention`; assert a peak greater than one, no rejection, and exactly one row
   per name with the registered interval.
8. **`workRemaining` becomes due immediately.** Using a task whose interval is well above the tick
   cadence (e.g. one hour), complete with `workRemaining: true` and assert `next_run_at` is
   approximately `databaseNow`, then immediately reclaim it with a fresh ordinary token to prove
   completion cleared the old lease. Complete another with `workRemaining: false` and assert it is
   approximately `databaseNow + 3_600_000`.
9. **Process-clock skew does not change decisions.** For a new row, assert its first `next_run_at`
   is approximately `databaseNow + intervalMs` and that it cannot yet be claimed. For a due row,
   compare the returned `scheduledFor` exactly with the pre-claim health row's `nextRunAt`, and
   assert `claim` and `health` return live `databaseNow` values. Do not attempt to change the
   process clock; assert the contract through its database-time results.
10. **Interval decrease clamps an unleased next run; increase does not postpone.** Reconcile at one
    hour, then at 60s; assert `next_run_at` moved in to within a minute. Reconcile back to one hour
    and assert an already-due run stays due.
11. **Reconcile during a live lease updates the cadence but not the schedule.** Reconcile a task,
    claim it (so a live lease is held), then reconcile the same name with a *different* interval.
    Assert through `health()` that `intervalMs` is now the new value while `nextRunAt` is
    unchanged — reconcile updates the cadence of a leased row but does not reschedule it.
    `RecurringTaskHealth` exposes no lease columns (only `leaseExpired`), so lease preservation
    is proved **behaviourally**: `complete` the still-held claim using the **original** token and
    assert it returns `true`. That is a stronger proof than reading a column, because it exercises
    the contract rather than the storage. Finally assert the resulting `next_run_at` reflects the
    **new** interval, not the one in force when the claim was taken. This is the case that proves
    why `complete()` reads the persisted column instead of accepting an interval from the runner —
    the rolling-deploy scenario in miniature.
12. **Health reports a currently expired lease.** Claim with the shortest permitted lease, wait
    past expiry without completing, and assert the health row has `leaseExpired: true` and
    `lastStatus: 'running'`.

**Making a task due.** This is the one piece of setup every test needs, and the obvious recipe
does not work: `reconcile` sets a new row's `next_run_at` to database-now *plus* the interval, so a
freshly-reconciled task is not claimable, and `complete` cannot be used to pull it forward because
`complete` requires a lease token that only a successful `claim` produces.

The working recipe uses a sub-minimum interval at the store level, exactly as the lease tests use a
sub-minimum lease, and for the same reason — **`MIN_INTERVAL_MS` constrains task definitions at
boot via `validateRecurringTasks`, not `ISchedulerStore` calls**:

```ts
// Due almost immediately.
await store.reconcile([{ name, intervalMs: 1 }])
const claim = await store.claim({ name, leaseMs: 60_000, owner: 'suite' })
// claim is non-null.

// Then, if the test needs a realistic cadence, widen it. The reconcile clamp
// only ever pulls an unleased next_run_at IN, never pushes it out, so a task
// that is already due stays due.
await store.reconcile([{ name, intervalMs: 3_600_000 }])
```

The same technique drives the backoff test: after each `fail`, `next_run_at` is a minute or more
away, so re-reconcile at `intervalMs: 1` between failures to make the row claimable again, and
assert the backoff by reading `health()` rather than by waiting for it.

Do **not** issue raw SQL to manipulate `next_run_at` — that would couple the suite to one adapter.

**Two fixture requirements that decide whether this suite catches real defects.** The
"stale token" cases must use a token that is **not a well-formed UUID** — Postgres stores
`lease_token` as `uuid` and MySQL as `char(36)`, so a random-but-valid UUID would exercise
neither backend's failure path, and a suite that only ever passes valid UUIDs cannot tell a
store that returns `false` from one that raises a type error. And the `health()` cases must
cover all four argument shapes — omitted, one name, several names, and an empty array —
because array binding is where adapter SQL generation most commonly breaks.
Do **not** relax `MIN_INTERVAL_MS` or `MIN_LEASE_MS`; they are definition-level and correct.

Behaviours 2 and 12 need a lease that expires inside a test, and they can have one:
**`MIN_LEASE_MS` constrains task *definitions*, not store calls.** `validateRecurringTasks` enforces
the 60-second floor at boot, but `ISchedulerStore.claim` takes `leaseMs` as an ordinary parameter
and does not validate it. A conformance test therefore calls `store.claim({ name, leaseMs: 100,
owner })` directly, waits ~150ms, and asserts the lease is reclaimable. No test seam, no weakening
of the constant, no sleeping for a minute.

If an implementation adds validation inside the store that rejects a sub-minimum lease, that is a
deviation from this plan — report it rather than working around it, because it would also prevent
a future consumer from choosing a short lease deliberately.

- [ ] **Step 3: Wire the hook in db-postgres**

In `packages/db-postgres/tests/conformance.integration.test.ts`, add to the hooks object:

```ts
  async createSchedulerStore(): Promise<ISchedulerStore> {
    const testDb = setupTestDB([])
    return createSchedulerStore(testDb.db)
  },
```

- [ ] **Step 4: Run the suite**

```bash
cd postgres && ./postgres.sh up -d
cd .. && pnpm db:init:test
cd packages/db-postgres && pnpm test:integration
```
Expected: the scheduler suite runs and every test passes, and no previously-passing suite regresses.
Paste the full output into the hand-off.

- [ ] **Step 5: Commit**

```bash
pnpm lint
git add packages/db-conformance/src packages/db-postgres/tests
git commit -s -m "feat(scheduler): added the shared scheduler conformance suite"
```

---

### Task 6: `runDueTasks()` — one claim-and-run pass

No timers. This is the unit an external cron or a test drives.

**Files:**
- Create: `packages/core/src/scheduler/run-due-tasks.ts`
- Create: `packages/core/src/scheduler/run-due-tasks.test.node.ts`
- Modify: `packages/core/src/scheduler/index.ts` (export it)

**Interfaces:**
- Consumes: `ISchedulerStore`, `RecurringTaskDefinition`, `RecurringTaskContext` (Task 1).
- Produces, in two layers:
  - **Public:** `runDueTasks(core: BylineCore, options?: RunDueTasksOptions): Promise<RunDueTasksSummary>`
    where `RunDueTasksOptions = { signal?: AbortSignal; concurrency?: number; owner?: string }`.
    It reads `core.db.scheduler` (throwing a clear error when absent), `core.recurringTasks`, and
    `core.logger`, then delegates.
  - **Internal:** `runDueTasksWithDeps(params: { store: ISchedulerStore; tasks: readonly RecurringTaskDefinition[]; owner: string; logger: BylineLogger; signal?: AbortSignal; concurrency?: number }): Promise<RunDueTasksSummary>`
    where `RunDueTasksSummary = { claimed: number; succeeded: number; failed: number }`.
    Not exported from the barrel; unit tests import it by relative path.
  - `defaultOwner(): string` — a bounded, non-secret diagnostic label, `` `${hostname()}:${process.pid}` ``,
    truncated to 255 characters. Correctness never depends on its uniqueness.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/scheduler/run-due-tasks.test.node.ts`. Build an in-memory fake
`ISchedulerStore` — no database. The fake records calls and lets each test decide what `claim`
returns.

```ts
// (MPL header)

import { describe, expect, it, vi } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { runDueTasksWithDeps } from './run-due-tasks.js'
import type { ClaimedRecurringTask, ISchedulerStore } from './types.js'

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as never

function claimed(name: string): ClaimedRecurringTask {
  return {
    name,
    leaseToken: `token-${name}`,
    scheduledFor: new Date('2026-08-22T00:00:00Z'),
    databaseNow: new Date('2026-08-22T00:00:00Z'),
    recoveredExpiredLease: false,
  }
}

function fakeStore(overrides: Partial<ISchedulerStore> = {}): ISchedulerStore {
  return {
    reconcile: vi.fn(async () => {}),
    claim: vi.fn(async () => null),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    health: vi.fn(async () => []),
    ...overrides,
  }
}

describe('runDueTasks', () => {
  it('does nothing when no task is due', async () => {
    const run = vi.fn()
    const store = fakeStore()
    const task = defineRecurringTask({
      name: 'a', intervalMs: 60_000, leaseMs: 60_000, run,
    })

    const summary = await runDueTasksWithDeps({
      store, tasks: [task], owner: 'test', logger: silentLogger,
    })

    expect(run).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 0, succeeded: 0, failed: 0 })
  })

  it('runs a claimed task and completes it', async () => {
    const run = vi.fn(async () => {})
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const task = defineRecurringTask({
      name: 'a', intervalMs: 60_000, leaseMs: 60_000, run,
    })

    const summary = await runDueTasksWithDeps({
      store, tasks: [task], owner: 'test', logger: silentLogger,
    })

    expect(run).toHaveBeenCalledTimes(1)
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a', leaseToken: 'token-a', workRemaining: false })
    )
    expect(summary.succeeded).toBe(1)
  })

  it('passes workRemaining through to complete', async () => {
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const task = defineRecurringTask({
      name: 'a', intervalMs: 3_600_000, leaseMs: 60_000,
      run: async () => ({ workRemaining: true }),
    })

    await runDueTasksWithDeps({ store, tasks: [task], owner: 'test', logger: silentLogger })

    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({ workRemaining: true })
    )
  })

  it('records a failure and does not throw when a handler rejects', async () => {
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const task = defineRecurringTask({
      name: 'a', intervalMs: 60_000, leaseMs: 60_000,
      run: async () => { throw new Error('boom') },
    })

    const summary = await runDueTasksWithDeps({
      store, tasks: [task], owner: 'test', logger: silentLogger,
    })

    expect(store.fail).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a', error: expect.stringContaining('boom') })
    )
    expect(store.complete).not.toHaveBeenCalled()
    expect(summary.failed).toBe(1)
  })

  it('continues other tasks when one fails', async () => {
    const ranB = vi.fn(async () => {})
    const store = fakeStore({ claim: vi.fn(async ({ name }) => claimed(name)) })
    const tasks = [
      defineRecurringTask({
        name: 'a', intervalMs: 60_000, leaseMs: 60_000,
        run: async () => { throw new Error('boom') },
      }),
      defineRecurringTask({ name: 'b', intervalMs: 60_000, leaseMs: 60_000, run: ranB }),
    ]

    const summary = await runDueTasksWithDeps({
      store, tasks, owner: 'test', logger: silentLogger,
    })

    expect(ranB).toHaveBeenCalledTimes(1)
    expect(summary).toEqual({ claimed: 2, succeeded: 1, failed: 1 })
  })

  it('never throws when the store itself rejects', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => { throw new Error('db down') }),
    })
    const task = defineRecurringTask({
      name: 'a', intervalMs: 60_000, leaseMs: 60_000, run: async () => {},
    })

    await expect(
      runDueTasksWithDeps({ store, tasks: [task], owner: 'test', logger: silentLogger })
    ).resolves.toBeDefined()
  })

  it('aborts the handler signal when the lease is lost on heartbeat', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => claimed('a')),
      renew: vi.fn(async () => false),
    })
    let sawAbort = false
    const task = defineRecurringTask({
      name: 'a', intervalMs: 3_600_000, leaseMs: 60_000,
      run: async (ctx) => {
        await expect(ctx.heartbeat()).rejects.toThrow()
        sawAbort = ctx.signal.aborted
      },
    })

    await runDueTasksWithDeps({ store, tasks: [task], owner: 'test', logger: silentLogger })

    expect(sawAbort).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/run-due-tasks.test.node.ts`
Expected: FAIL — cannot resolve `./run-due-tasks.js`.

- [ ] **Step 3: Implement `run-due-tasks.ts`**

Required behaviour:

- `runDueTasks(core, options)` resolves `core.db.scheduler` and throws a clear, actionable error
  when the adapter lacks the capability; resolves `options.owner ?? defaultOwner()`; and calls
  `runDueTasksWithDeps` with `core.recurringTasks` and `core.logger`. It accepts no `tasks`
  parameter.
- `runDueTasksWithDeps` does the work below.
- Attempt `store.claim({ name, leaseMs, owner })` for every definition. A null result is not an
  error — another instance won, or the task is not due.
- Execute claimed tasks with a small fixed concurrency bound (default 2, overridable) so a slow
  task cannot delay an unrelated one.
- Build each `RecurringTaskContext` with an `AbortController` per run, `scheduledFor` from the
  claim, and a `heartbeat()` that calls `store.renew` and, when it returns false, aborts the
  controller and rejects.
- On resolve, call `store.complete` with `workRemaining` from the result (defaulting to `false`)
  and the measured duration.
- On reject, call `store.fail` with the error message truncated to 2048 characters and the measured
  duration. The persisted message is a sanitized single line; the full error remains in the
  configured logger. **Never rethrow** — one task's failure must not abort the pass.
- A heartbeat that returns `false` proves the lease token was fenced. Abort the handler signal
  before rejecting `heartbeat()`, count the run as failed, and do **not** call `store.fail` or
  `store.complete` with the known-stale token. Apply the same no-finalization rule after the
  incoming shutdown signal aborts an active run. A heartbeat store rejection also aborts and
  leaves the lease to expire because ownership is then uncertain.
- A `false` return from `complete` is a lost-lease outcome, not a successful run. Count it as
  failed, log the distinct lost-lease event, and do not attempt `fail` afterward.
- Wrap every store call so a store-level rejection is logged and counted, not thrown.
- Honour an incoming `signal`: stop claiming further tasks once it aborts.
- Log structured start, success, failure, and lost-lease events with name, duration, and owner.
  Never log task arguments — recurring definitions have none.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/run-due-tasks.test.node.ts`
Expected: PASS. The focused suite additionally pins the public core-only task source, bounded
concurrency, shutdown ordering, all four store-call rejection paths, error sanitization, expired
lease recovery logging, and the rule that a known-lost token is never finalized.

- [ ] **Step 5: Export it and commit**

Add to `packages/core/src/scheduler/index.ts`:

```ts
export { runDueTasks, type RunDueTasksOptions, type RunDueTasksSummary } from './run-due-tasks.js'
```

Export **only** the core-based `runDueTasks`. `runDueTasksWithDeps` and `defaultOwner` stay
unexported from the barrel. Do not add any of them to the package root.

```bash
cd packages/core && pnpm typecheck && pnpm test
cd ../.. && pnpm lint
git add packages/core/src/scheduler
git commit -s -m "feat(scheduler): added runDueTasks, the claim-and-run pass"
```

---

### Task 7: `startBylineScheduler()` — the ticker

**Files:**
- Create: `packages/core/src/scheduler/ticker.ts`
- Create: `packages/core/src/scheduler/ticker.test.node.ts`
- Modify: `packages/core/src/scheduler/index.ts` (export it)

**Interfaces:**
- Consumes: `runDueTasks` (Task 6), `ISchedulerStore`, `RecurringTaskDefinition` (Task 1).
- Produces, in two layers:
  - **Public:** `startBylineScheduler(core: BylineCore, options?: SchedulerOptions): SchedulerController`
    where `SchedulerOptions = { tickIntervalMs?: number; startupJitterMs?: number; concurrency?: number; owner?: string; shutdownGraceMs?: number }`
    and `SchedulerController = { stop(): Promise<void> }`. Resolves store, validated tasks, and
    logger from `core` exactly as `runDueTasks` does.
  - **Internal:** `startSchedulerWithDeps(params: { store; tasks; owner; logger; tickIntervalMs?; startupJitterMs?; concurrency?; shutdownGraceMs? }): SchedulerController`.
    Not exported from the barrel; unit tests import it by relative path.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/scheduler/ticker.test.node.ts` using vitest fake timers
(`vi.useFakeTimers()`), asserting:

1. **Nothing runs before the jitter elapses.** Start with `startupJitterMs: 30_000`; advance
   29_000ms; assert the store's `claim` has not been called.
2. **Reconcile runs once at startup, before the first tick.**
3. **Ticks do not overlap.** Make `claim` return a task whose `run` never settles within the test;
   advance several tick intervals; assert `claim` was called once, not once per interval.
4. **`stop()` prevents another tick.** Advance past one tick, call `stop()`, advance several more
   intervals, assert no further `claim`.
5. **`stop()` aborts in-flight handler signals.** Assert the running handler's `ctx.signal.aborted`
   becomes true after `stop()`.
6. **A rejected tick does not kill the ticker.** Make the first tick's store call reject; advance
   two intervals; assert a second tick still occurred.

Use `vi.useFakeTimers()` in `beforeEach` and `vi.useRealTimers()` in `afterEach`. Prefer
`await vi.advanceTimersByTimeAsync(ms)` so promise chains flush between timer steps.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/ticker.test.node.ts`
Expected: FAIL — cannot resolve `./ticker.js`.

- [ ] **Step 3: Implement `ticker.ts`**

Required behaviour:

- Call `store.reconcile()` once with the registered definitions before scheduling the first tick.
- Wait a random `0..startupJitterMs` (default 30_000) before the first tick, so a deploy that
  restarts every machine does not produce a synchronised tick.
- Use a **recursive `setTimeout`**, never `setInterval`, and schedule the next timeout only after
  the current tick's `runDueTasks` settles. Two local ticks must never overlap.
- Default `tickIntervalMs` to 60_000.
- `stop()` clears the pending timeout, aborts the controller shared with in-flight handlers, then
  waits for the in-flight tick to settle up to `shutdownGraceMs` (**default 5_000**) and resolves
  either way. It does **not** forge successful completion and does **not** write to the store on
  behalf of an aborted run — unfinished leases expire naturally, and the next instance reclaims
  them after expiry. `stop()` is idempotent: a second call resolves immediately.
- When a handler's run ends because its lease was lost, the pass counts it under `failed` and does
  **not** call `store.fail` — the token no longer matches, so the write would be rejected anyway,
  and a newer run now owns the row. Log it as a distinct `lost-lease` event rather than a failure.
- Catch everything inside the tick. A rejected tick logs and schedules the next one.
- Call `unref()` on the timeout handle if available, so a pending tick cannot by itself keep a
  process alive.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/core && pnpm vitest run --mode=node src/scheduler/ticker.test.node.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Full verification**

```bash
cd packages/core && pnpm test && pnpm typecheck && pnpm build
cd ../.. && pnpm lint
```
Expected: all green. Paste the output into the hand-off.

- [ ] **Step 6: Export and commit**

Add to `packages/core/src/scheduler/index.ts`:

```ts
export {
  startBylineScheduler,
  type SchedulerController,
  type SchedulerOptions,
} from './ticker.js'
```

Export **only** the core-based `startBylineScheduler`; `startSchedulerWithDeps` stays internal.

```bash
git add packages/core/src/scheduler
git commit -s -m "feat(scheduler): added the in-process ticker with jitter and non-overlapping ticks"
```

---

### Task 8: Hand-written Postgres upgrade script

The Drizzle-independent upgrade path for deployed databases. Written last, against the schema the
conformance suite has already proven, so it never needs amending.

**Files:**
- Create: `packages/db-postgres/sql/0007_add-recurring-tasks.sql`

**Interfaces:**
- Consumes: the finished `byline_recurring_tasks` schema (Tasks 3–5).
- Produces: nothing consumed by code. This is a shipped artifact for operators.

- [ ] **Step 1: Read the conventions**

Read `packages/db-postgres/sql/README.md` in full, and open `0005_add-admin-user-preferences.sql`
as the closest existing example — it also adds to the schema rather than backfilling data.

- [ ] **Step 2: Confirm the script number**

Run: `ls packages/db-postgres/sql/`
Expected: the highest existing number is `0006`. Use `0007`. If something has landed since this
plan was written and `0007` is taken, take the next free number and say so in the hand-off.

- [ ] **Step 3: Write the script**

Requirements, all of them non-negotiable and taken from the README:

- **Idempotent.** `CREATE TABLE IF NOT EXISTS`. An operator who runs it twice must see no error and
  no change on the second run.
- **Wrapped in a single transaction.** `BEGIN;` … `COMMIT;`.
- **Must end with the ownership guard**, immediately before `COMMIT`, copied **verbatim** from any
  existing script that creates a table. Do not adapt it, do not name the new table in it — it names
  no table by design and converges all mis-owned public objects to the database owner. This is
  CI-enforced: `src/database/ownership-guard.test.node.ts` fails the build if a script containing
  `CREATE TABLE` lacks the `-- byline:ownership-guard` marker or the reassignment statement.
- **Column definitions must match the Drizzle schema exactly** — same types, same nullability, same
  defaults. A drift between the two streams produces a database that passes migration and then
  fails at runtime on one deployment path only.
- **Header comment** naming what the script adds and which Byline feature it belongs to, in the
  style of the existing scripts.

- [ ] **Step 4: Verify it applies to a clean database**

```bash
createdb byline_sqlcheck
psql byline_sqlcheck -f packages/db-postgres/sql/0007_add-recurring-tasks.sql
psql byline_sqlcheck -f packages/db-postgres/sql/0007_add-recurring-tasks.sql
psql byline_sqlcheck -c '\d byline_recurring_tasks'
dropdb byline_sqlcheck
```
Expected: both applications succeed (the second changing nothing), and the printed table structure
matches the Drizzle definition column for column. Paste the `\d` output into the hand-off — that
is the evidence the two streams agree.

- [ ] **Step 5: Run the ownership-guard test**

Run: `cd packages/db-postgres && pnpm vitest run --mode=node src/database/ownership-guard.test.node.ts`
Expected: PASS, with the new script included in what it checks.

- [ ] **Step 6: Commit**

```bash
pnpm lint
git add packages/db-postgres/sql
git commit -s -m "feat(scheduler): added the hand-written postgres upgrade script for recurring tasks"
```

---

## Review checkpoints

Two of the spec's acceptance criteria are structural rather than testable, and are checked by
review rather than by an assertion:

- **Criterion 4 — importing server config from a seed or maintenance script starts no timer and
  does not keep the process alive.** Guaranteed by `initBylineCore()` never calling
  `startBylineScheduler()`. The reviewer confirms no timer, interval, or `setTimeout` reaches any
  path under `initBylineCore`, and that Task 2's registration only stores definitions.
- **Packaging — the browser-safe root never pulls in Node timers.** The reviewer confirms
  `packages/core/src/index.ts` re-exports only the inert surface, and that neither `runDueTasks`
  nor `startBylineScheduler` is reachable from it.

## Out of scope for this plan

Named so nobody adds them speculatively:

- **MySQL store, and its hand-written script.** A second pass runs the same conformance suite; the
  suite is the deliverable that makes it mechanical. `packages/db-mysql/sql/` gets its own numbered
  script at the end of that pass, following `packages/db-mysql/sql/README.md`.
- **The release squash.** Collapsing the Drizzle migrations into the CLI's fresh-install baseline
  and resetting the migration key is release process, not feature work. Task 8 exists so that
  squash is safe: deployed installations upgrade by the hand-written script, not by the baseline.
- **`startBylineScheduler()` host wiring.** Calling it from `apps/webapp/src/server.ts` belongs with
  the first real consumer, not with the primitive.
- **Any recurring task.** Analytics rollup and scheduled publication are separate specs. This plan
  ships a scheduler with zero registered tasks, which is the correct end state for it.
- **An admin health page.** The spec defers it; `store.health()` is the contract a later surface
  reads.
- **HTTP exposure of `runDueTasks()`.** The spec explicitly declines to invent remote
  authentication for it.
