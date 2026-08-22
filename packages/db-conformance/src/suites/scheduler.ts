/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ClaimedRecurringTask, ISchedulerStore, RecurringTaskHealth } from '@byline/core'
import { v4 as uuidv4 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks, SchedulerContentionObserver } from '../index.js'

/**
 * Proves the claim-and-fence protocol described on `ISchedulerStore`
 * (`packages/core/src/scheduler/types.ts`) purely through that interface —
 * never Drizzle, never `pg`, never any adapter-internal handle. A future
 * MySQL (or any other) adapter implementing `ISchedulerStore` runs this
 * exact suite unchanged; that is what makes the port mechanical rather than
 * a rewrite.
 *
 * `MIN_INTERVAL_MS` / `MIN_LEASE_MS` (60s) constrain task *definitions* at
 * boot via `validateRecurringTasks` — `ISchedulerStore` itself does not
 * enforce either floor, so this suite deliberately uses sub-minimum
 * `intervalMs` / `leaseMs` values to make a row claimable, and a lease
 * expire, inside a single test:
 *
 * ```ts
 * await store.reconcile([{ name, intervalMs: 1 }])           // due almost immediately
 * const claim = await store.claim({ name, leaseMs: 60_000, owner: 'suite' })
 * await store.reconcile([{ name, intervalMs: 3_600_000 }])   // widen once claimable
 * ```
 *
 * The reconcile clamp only ever pulls an unleased `next_run_at` IN, never
 * pushes it out, so a row that is already due stays due after widening.
 *
 * In practice, "due almost immediately" needs a short, explicit wait before
 * the claim: once this suite's shared connection pool is warm (every test
 * after the first reuses it), a `reconcile` + `claim` round trip can complete
 * in under a millisecond, which occasionally races an `intervalMs: 1` row's
 * due time. `makeDue` (below) reconciles at `intervalMs: 1` and then sleeps
 * `SETUP_SEPARATION_MS` — long enough to clear that race deterministically,
 * negligible against the suite's overall runtime, and not a relaxation of
 * `MIN_INTERVAL_MS` (which gates task *definitions*, not this store-level
 * fixture).
 *
 * Behaviours 1 and 7 use `hooks.observeSchedulerContention` to prove that
 * several claims/reconciles were genuinely in flight on more than one
 * physical database connection. A hook backed by a single-connection pool
 * therefore fails loudly instead of silently serialising the calls into
 * non-tests. Behaviour 1 uses 8 concurrent claims rather than 2 so the race
 * also exercises pool queuing under a deliberately small test pool.
 */
export function schedulerSuite(hooks: ConformanceHooks): void {
  let store: ISchedulerStore
  let observeContention: SchedulerContentionObserver

  const ts = Date.now()
  let counter = 0
  /** A fresh, collision-free task name for one test. */
  const taskName = (label: string): string => `sched-${label}-${ts}-${counter++}`

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** See the module doc comment above: closes the warm-pool race on a
   * fresh `intervalMs: 1` row's due time. */
  const SETUP_SEPARATION_MS = 10

  /** Reconciles `name` at a sub-minimum interval and waits long enough that
   * it is reliably due on the very next `claim`. */
  async function makeDue(name: string): Promise<void> {
    await store.reconcile([{ name, intervalMs: 1 }])
    await sleep(SETUP_SEPARATION_MS)
  }

  /**
   * Tolerance for comparing a computed `next_run_at` against a wall-clock
   * expectation. Generous enough to absorb container/network round-trips
   * without masking a real defect at minute-scale deltas.
   */
  const TOLERANCE_MS = 5_000

  function assertClose(actual: Date, expected: number, label: string): void {
    const delta = Math.abs(actual.getTime() - expected)
    expect(delta, `${label}: expected within ${TOLERANCE_MS}ms, was ${delta}ms off`).toBeLessThan(
      TOLERANCE_MS
    )
  }

  /** Narrows a nullable/optional result, throwing with a clear message
   * instead of leaning on a non-null assertion. */
  function assertDefined<T>(value: T | null | undefined, message: string): T {
    if (value === null || value === undefined) {
      throw new Error(message)
    }
    return value
  }

  /** `store.claim(...)`, asserted non-null and narrowed for the rest of the test. */
  async function claimOrThrow(params: {
    name: string
    leaseMs: number
    owner: string
  }): Promise<ClaimedRecurringTask> {
    const claim = await store.claim(params)
    return assertDefined(claim, `expected a successful claim for '${params.name}'`)
  }

  function firstOrThrow(
    rows: readonly RecurringTaskHealth[],
    context: string
  ): RecurringTaskHealth {
    return assertDefined(
      rows[0],
      `expected at least one health row (${context}), got ${rows.length}`
    )
  }

  /** The single health row for one task name. Throws if it is missing —
   * every call site below has just reconciled or claimed that name, so a
   * missing row is a genuine defect, not an expected outcome to branch on. */
  async function healthOf(name: string): Promise<RecurringTaskHealth> {
    const rows = await store.health([name])
    return firstOrThrow(rows, name)
  }

  describe('scheduler store (ISchedulerStore conformance)', () => {
    beforeAll(async () => {
      await hooks.truncate()
      const createStore = hooks.createSchedulerStore
      if (!createStore) {
        throw new Error('schedulerSuite requires hooks.createSchedulerStore')
      }
      const observe = hooks.observeSchedulerContention
      if (!observe) {
        throw new Error(
          'schedulerSuite requires hooks.observeSchedulerContention to prove real database contention'
        )
      }
      store = await createStore()
      observeContention = observe
    })

    it('1. two simultaneous claims on the same due task produce exactly one winner', async () => {
      const name = taskName('two-claims')
      await makeDue(name)

      // 8 concurrent attempts, not 2 — see the module doc comment on why a
      // small number of callers can accidentally serialise through a small
      // pool and pass without proving real contention.
      const observation = await observeContention(() =>
        Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            store.claim({ name, leaseMs: 60_000, owner: `suite-${i}` })
          )
        )
      )

      expect(observation.maxConcurrentConnections).toBeGreaterThan(1)
      const winners = observation.result.filter((claim) => claim !== null)
      expect(winners).toHaveLength(1)
    })

    it('2. a live lease cannot be stolen; an expired lease can be reclaimed with a new token', async () => {
      const liveName = taskName('lease-live')
      await makeDue(liveName)
      const holderClaim = await claimOrThrow({ name: liveName, leaseMs: 60_000, owner: 'holder' })
      // An ordinary claim of a fresh, never-leased row is NOT a recovery.
      expect(holderClaim.recoveredExpiredLease).toBe(false)

      const beforeSteal = await healthOf(liveName)
      const stolen = await store.claim({ name: liveName, leaseMs: 60_000, owner: 'thief' })
      expect(stolen).toBeNull()

      // The failed steal must leave the row exactly as it was: a successful
      // claim always rewrites `last_started_at` (per the contract's column
      // list), so an unchanged value here proves the thief's attempt never
      // reached that write path.
      const afterSteal = await healthOf(liveName)
      expect(afterSteal.lastStartedAt).toEqual(beforeSteal.lastStartedAt)
      // And the lease itself is intact: the original holder's token still
      // renews, which would fail if the steal had reassigned lease_token.
      await expect(
        store.renew({ name: liveName, leaseToken: holderClaim.leaseToken, leaseMs: 60_000 })
      ).resolves.toBe(true)

      // A true return is not enough to prove heartbeat semantics: a
      // token-matched no-op UPDATE also reports one changed row. Renew a short
      // lease, wait beyond its original expiry, and prove a competing claim is
      // still excluded by the extended lease window.
      const renewalName = taskName('lease-renewal')
      await makeDue(renewalName)
      const renewalClaim = await claimOrThrow({
        name: renewalName,
        leaseMs: 300,
        owner: 'heartbeat-holder',
      })
      await sleep(150)
      await expect(
        store.renew({ name: renewalName, leaseToken: renewalClaim.leaseToken, leaseMs: 1_000 })
      ).resolves.toBe(true)
      await sleep(250)
      await expect(
        store.claim({ name: renewalName, leaseMs: 60_000, owner: 'post-heartbeat-thief' })
      ).resolves.toBeNull()

      // Expiry makes the row claimable; it does not itself invalidate the
      // token. Until another claimant replaces that token, the original
      // runner may recover from a pause by renewing even after its deadline.
      const lateRenewalName = taskName('lease-late-renewal')
      await makeDue(lateRenewalName)
      const lateRenewalClaim = await claimOrThrow({
        name: lateRenewalName,
        leaseMs: 100,
        owner: 'late-heartbeat-holder',
      })
      await sleep(150)
      await expect(
        store.renew({
          name: lateRenewalName,
          leaseToken: lateRenewalClaim.leaseToken,
          leaseMs: 60_000,
        })
      ).resolves.toBe(true)
      await expect(
        store.claim({ name: lateRenewalName, leaseMs: 60_000, owner: 'late-heartbeat-thief' })
      ).resolves.toBeNull()

      const expiringName = taskName('lease-expiring')
      await makeDue(expiringName)
      const shortLived = await claimOrThrow({
        name: expiringName,
        leaseMs: 100,
        owner: 'holder',
      })

      await sleep(150)

      const recovered = await claimOrThrow({
        name: expiringName,
        leaseMs: 60_000,
        owner: 'rescuer',
      })
      expect(recovered.leaseToken).not.toBe(shortLived.leaseToken)
      expect(recovered.recoveredExpiredLease).toBe(true)
    })

    it('3. a stale token cannot heartbeat, complete, fail, or overwrite a newer run', async () => {
      const name = taskName('stale-token')
      await makeDue(name)

      const tokenA = await claimOrThrow({ name, leaseMs: 100, owner: 'runner-a' })

      await sleep(150)

      const tokenB = await claimOrThrow({ name, leaseMs: 60_000, owner: 'runner-b' })
      expect(tokenB.leaseToken).not.toBe(tokenA.leaseToken)

      // Snapshot the token-B row before any stale/malformed attempt below,
      // so "overwrite a newer run" is checked on more than just the lease
      // token surviving — a read-then-write implementation could return
      // `false` while still having mutated status/failure/schedule fields.
      const beforeStaleAttempts = await healthOf(name)

      // Fixture requirement: a token that is not a well-formed UUID at all —
      // this is the case that historically raised 22P02 instead of
      // returning false (Postgres's `lease_token` column is `uuid`; MySQL's
      // is `char(36)`, so a malformed string must fail identically on both).
      const malformed = 'not-a-uuid-at-all'
      await expect(store.renew({ name, leaseToken: malformed, leaseMs: 60_000 })).resolves.toBe(
        false
      )
      await expect(
        store.complete({ name, leaseToken: malformed, durationMs: 1, workRemaining: false })
      ).resolves.toBe(false)
      await expect(
        store.fail({ name, leaseToken: malformed, durationMs: 1, error: 'malformed' })
      ).resolves.toBe(false)

      // Fixture requirement: a token that IS a well-formed UUID, but simply
      // the wrong one.
      const wrongButValidUuid = uuidv4()
      await expect(
        store.renew({ name, leaseToken: wrongButValidUuid, leaseMs: 60_000 })
      ).resolves.toBe(false)

      // The original (stale, now-superseded) token: heartbeat, complete, and
      // fail must all report false, never throw.
      await expect(
        store.renew({ name, leaseToken: tokenA.leaseToken, leaseMs: 60_000 })
      ).resolves.toBe(false)
      await expect(
        store.complete({
          name,
          leaseToken: tokenA.leaseToken,
          durationMs: 1,
          workRemaining: false,
        })
      ).resolves.toBe(false)
      await expect(
        store.fail({ name, leaseToken: tokenA.leaseToken, durationMs: 1, error: 'stale' })
      ).resolves.toBe(false)

      // None of the above touched the row: status, failure bookkeeping, and
      // schedule are byte-for-byte what they were before any stale attempt.
      const afterStaleAttempts = await healthOf(name)
      expect(afterStaleAttempts.lastStatus).toBe(beforeStaleAttempts.lastStatus)
      expect(afterStaleAttempts.consecutiveFailures).toBe(beforeStaleAttempts.consecutiveFailures)
      expect(afterStaleAttempts.lastError).toBe(beforeStaleAttempts.lastError)
      expect(afterStaleAttempts.nextRunAt.getTime()).toBe(beforeStaleAttempts.nextRunAt.getTime())

      // The token-B row is untouched by any of the above: it can still be
      // renewed with its own, still-valid token.
      await expect(
        store.renew({ name, leaseToken: tokenB.leaseToken, leaseMs: 60_000 })
      ).resolves.toBe(true)
    })

    it('4. success advances next_run_at from database time and clears failure state', async () => {
      const name = taskName('success-clears-failure')
      const realInterval = 3_600_000
      await makeDue(name)

      const failedClaim = await claimOrThrow({ name, leaseMs: 60_000, owner: 'suite' })
      const oversizedError = 'x'.repeat(3_000)
      await store.fail({
        name,
        leaseToken: failedClaim.leaseToken,
        durationMs: 17,
        error: oversizedError,
      })

      // The Date-ness of the typed timestamp columns matters as much as
      // their value — this is exactly the class of defect a store could
      // ship (a raw driver string surviving through to the contract) while
      // every other assertion in this suite still passes.
      const failedRow = await healthOf(name)
      expect(failedRow.lastStartedAt).toBeInstanceOf(Date)
      expect(failedRow.lastFailedAt).toBeInstanceOf(Date)
      expect(failedRow.lastStatus).toBe('failed')
      expect(failedRow.lastDurationMs).toBe(17)
      expect(failedRow.lastError).toBe('x'.repeat(2_048))

      // Pull the row due again, then widen to a realistic cadence before the
      // successful claim so `complete`'s persisted-interval math is
      // checkable. `makeDue` (not a bare `reconcile`) does the due-ing here
      // so the widen-reconcile that follows isn't racing a warm connection
      // pool the same way the original recipe did.
      await makeDue(name)
      await store.reconcile([{ name, intervalMs: realInterval }])

      const succeedingClaim = await claimOrThrow({ name, leaseMs: 60_000, owner: 'suite' })

      await store.complete({
        name,
        leaseToken: succeedingClaim.leaseToken,
        durationMs: 20,
        workRemaining: false,
      })

      const row = await healthOf(name)
      expect(row.consecutiveFailures).toBe(0)
      expect(row.lastError).toBeNull()
      expect(row.lastStatus).toBe('succeeded')
      expect(row.lastDurationMs).toBe(20)
      expect(row.lastSucceededAt).toBeInstanceOf(Date)
      assertClose(
        row.nextRunAt,
        succeedingClaim.databaseNow.getTime() + realInterval,
        'next_run_at'
      )
    })

    it('5. failure applies bounded backoff (1, 2, 4, 8... capped at 15min) and success resets it', async () => {
      const name = taskName('backoff')
      const realInterval = 3_600_000

      async function claimAndFail(): Promise<{ referenceNow: Date }> {
        await makeDue(name)
        const claim = await claimOrThrow({ name, leaseMs: 60_000, owner: 'suite' })
        await store.fail({
          name,
          leaseToken: claim.leaseToken,
          durationMs: 5,
          error: 'backoff-probe',
        })
        return { referenceNow: claim.databaseNow }
      }

      const first = await claimAndFail()
      let row = await healthOf(name)
      assertClose(row.nextRunAt, first.referenceNow.getTime() + 1 * 60_000, 'failure 1 (~1min)')
      expect(row.consecutiveFailures).toBe(1)

      const second = await claimAndFail()
      row = await healthOf(name)
      assertClose(row.nextRunAt, second.referenceNow.getTime() + 2 * 60_000, 'failure 2 (~2min)')
      expect(row.consecutiveFailures).toBe(2)

      const third = await claimAndFail()
      row = await healthOf(name)
      assertClose(row.nextRunAt, third.referenceNow.getTime() + 4 * 60_000, 'failure 3 (~4min)')
      expect(row.consecutiveFailures).toBe(3)

      // The contract names 8 minutes for the fourth consecutive failure —
      // asserted exactly, not just "no more than the 15min cap", so a store
      // that jumps to the cap early can't pass by coincidence.
      const fourth = await claimAndFail()
      row = await healthOf(name)
      assertClose(row.nextRunAt, fourth.referenceNow.getTime() + 8 * 60_000, 'failure 4 (~8min)')
      expect(row.consecutiveFailures).toBe(4)

      const fifth = await claimAndFail()
      row = await healthOf(name)
      assertClose(
        row.nextRunAt,
        fifth.referenceNow.getTime() + 15 * 60_000,
        'failure 5 (capped ~15min)'
      )
      expect(row.consecutiveFailures).toBe(5)

      // A sixth failure proves the cap holds for "every subsequent one" (the
      // contract's wording), not just the first failure past the doubling
      // sequence.
      const sixth = await claimAndFail()
      row = await healthOf(name)
      assertClose(
        row.nextRunAt,
        sixth.referenceNow.getTime() + 15 * 60_000,
        'failure 6 (still capped ~15min)'
      )
      expect(row.consecutiveFailures).toBe(6)

      // A later success restores the configured interval and resets the
      // failure sequence — the backoff never compounds across a success.
      await makeDue(name)
      const succeeding = await claimOrThrow({ name, leaseMs: 60_000, owner: 'suite' })
      // Restore the persisted interval to a realistic value while the
      // lease is held, the same technique behaviour 11 relies on.
      await store.reconcile([{ name, intervalMs: realInterval }])
      await store.complete({
        name,
        leaseToken: succeeding.leaseToken,
        durationMs: 5,
        workRemaining: false,
      })

      const finalRow = await healthOf(name)
      expect(finalRow.consecutiveFailures).toBe(0)
      expect(finalRow.lastStatus).toBe('succeeded')
      expect(finalRow.intervalMs).toBe(realInterval)
      assertClose(
        finalRow.nextRunAt,
        succeeding.databaseNow.getTime() + realInterval,
        'restored interval next_run_at'
      )
    })

    it('6. reconciliation is idempotent, preserves health history, and never deletes dormant rows', async () => {
      const nameA = taskName('reconcile-idem-a')
      const nameB = taskName('reconcile-idem-b')

      await store.reconcile([
        { name: nameA, intervalMs: 1 },
        { name: nameB, intervalMs: 3_600_000 },
      ])
      await sleep(SETUP_SEPARATION_MS)
      // nameB's row, captured immediately after it first exists. Reconciled
      // again below (still at the same interval) and then omitted entirely
      // — it must come back byte-for-byte identical both times.
      const initialBRow = await healthOf(nameB)

      const claimA = await claimOrThrow({ name: nameA, leaseMs: 60_000, owner: 'suite' })
      await store.complete({
        name: nameA,
        leaseToken: claimA.leaseToken,
        durationMs: 5,
        workRemaining: false,
      })

      const beforeA = await healthOf(nameA)
      expect(beforeA.lastSucceededAt).not.toBeNull()

      // Re-reconcile the same input: the full health history must survive,
      // not just one field of it.
      await store.reconcile([
        { name: nameA, intervalMs: 1 },
        { name: nameB, intervalMs: 3_600_000 },
      ])
      const afterA = await healthOf(nameA)
      expect(afterA.lastSucceededAt).toEqual(beforeA.lastSucceededAt)
      expect(afterA.consecutiveFailures).toBe(beforeA.consecutiveFailures)
      expect(afterA.lastError).toBe(beforeA.lastError)
      expect(afterA.lastStatus).toBe(beforeA.lastStatus)

      // Reconcile a smaller set that omits nameB: its row must survive
      // completely unexecuted and unaltered — reconcile neither runs nor
      // deletes it, and doesn't so much as nudge its schedule.
      await store.reconcile([{ name: nameA, intervalMs: 1 }])
      const rows = await store.health([nameA, nameB])
      const bRow = assertDefined(
        rows.find((row) => row.name === nameB),
        `expected a dormant row for '${nameB}'`
      )
      expect(bRow.intervalMs).toBe(3_600_000)
      expect(bRow.lastStatus).toBe('never_run')
      expect(bRow.nextRunAt.getTime()).toBe(initialBRow.nextRunAt.getTime())
    })

    it('7. concurrent reconciliation of the same task converges to one row', async () => {
      const name = taskName('concurrent-reconcile')

      const observation = await observeContention(() =>
        Promise.all(
          Array.from({ length: 5 }, () => store.reconcile([{ name, intervalMs: 3_600_000 }]))
        )
      )

      expect(observation.maxConcurrentConnections).toBeGreaterThan(1)
      const rows = await store.health([name])
      expect(rows).toHaveLength(1)
      expect(firstOrThrow(rows, name).intervalMs).toBe(3_600_000)
    })

    it('8. workRemaining:true makes the next run due immediately; false honours the interval', async () => {
      const immediateName = taskName('work-remaining-true')
      await makeDue(immediateName)
      const immediateClaim = await claimOrThrow({
        name: immediateName,
        leaseMs: 60_000,
        owner: 'suite',
      })
      await store.reconcile([{ name: immediateName, intervalMs: 3_600_000 }])
      await store.complete({
        name: immediateName,
        leaseToken: immediateClaim.leaseToken,
        durationMs: 5,
        workRemaining: true,
      })
      const immediateRow = await healthOf(immediateName)
      assertClose(immediateRow.nextRunAt, immediateRow.databaseNow.getTime(), 'workRemaining:true')

      // Re-arming the schedule is useful only if completion also released the
      // lease. Reclaim with a new token immediately; `recoveredExpiredLease`
      // must be false because success cleared the old lease rather than
      // leaving it to expire.
      const rearmedClaim = await claimOrThrow({
        name: immediateName,
        leaseMs: 60_000,
        owner: 'suite-rearmed',
      })
      expect(rearmedClaim.leaseToken).not.toBe(immediateClaim.leaseToken)
      expect(rearmedClaim.recoveredExpiredLease).toBe(false)

      const deferredName = taskName('work-remaining-false')
      await makeDue(deferredName)
      const deferredClaim = await claimOrThrow({
        name: deferredName,
        leaseMs: 60_000,
        owner: 'suite',
      })
      await store.reconcile([{ name: deferredName, intervalMs: 3_600_000 }])
      await store.complete({
        name: deferredName,
        leaseToken: deferredClaim.leaseToken,
        durationMs: 5,
        workRemaining: false,
      })
      const deferredRow = await healthOf(deferredName)
      assertClose(
        deferredRow.nextRunAt,
        deferredRow.databaseNow.getTime() + 3_600_000,
        'workRemaining:false'
      )
    })

    it('9. decisions follow database time, not the process clock', async () => {
      const name = taskName('clock-skew')
      await makeDue(name)

      const beforeClaim = await healthOf(name)
      const claim = await claimOrThrow({ name, leaseMs: 60_000, owner: 'suite' })
      expect(claim.name).toBe(name)
      expect(claim.databaseNow).toBeInstanceOf(Date)
      expect(claim.scheduledFor.getTime()).toBe(beforeClaim.nextRunAt.getTime())
      // The claim only succeeded because the store's own notion of "now"
      // judged the row due — the contract exposes that value directly
      // rather than asking the caller to trust `Date.now()`.
      expect(claim.scheduledFor.getTime()).toBeLessThanOrEqual(claim.databaseNow.getTime())

      // The converse, which is the actual proof this behaviour is named
      // for: a task reconciled with a realistic interval is NOT due, and
      // `claim` must say so. Without this, "decisions follow database
      // time" was never checked against a task that ISN'T due.
      const futureName = taskName('clock-skew-not-due')
      const futureInterval = 3_600_000
      await store.reconcile([{ name: futureName, intervalMs: futureInterval }])
      const futureRow = await healthOf(futureName)
      assertClose(
        futureRow.nextRunAt,
        futureRow.databaseNow.getTime() + futureInterval,
        'initial next_run_at'
      )
      await expect(
        store.claim({ name: futureName, leaseMs: 60_000, owner: 'suite' })
      ).resolves.toBeNull()

      // Two successive health() reads: databaseNow strictly increases,
      // proving it is a live read of database time on each call, not a
      // cached or constant value.
      const firstRead = await healthOf(name)
      await sleep(5)
      const secondRead = await healthOf(name)
      expect(secondRead.databaseNow.getTime()).toBeGreaterThan(firstRead.databaseNow.getTime())
    })

    it('10. an interval decrease clamps an unleased next run; an increase never postpones it', async () => {
      const name = taskName('interval-clamp')

      await store.reconcile([{ name, intervalMs: 3_600_000 }])
      const afterLong = await healthOf(name)

      await store.reconcile([{ name, intervalMs: 60_000 }])
      const afterShort = await healthOf(name)
      expect(afterShort.nextRunAt.getTime()).toBeLessThan(afterLong.nextRunAt.getTime())
      expect(afterShort.nextRunAt.getTime()).toBeLessThanOrEqual(
        afterShort.databaseNow.getTime() + 60_000 + TOLERANCE_MS
      )

      // Make the row due, then reconcile back up to a long interval: an
      // already-due run must stay due, never postponed.
      await makeDue(name)
      const dueRow = await healthOf(name)
      expect(dueRow.nextRunAt.getTime()).toBeLessThanOrEqual(dueRow.databaseNow.getTime())

      await store.reconcile([{ name, intervalMs: 3_600_000 }])
      const stillDueRow = await healthOf(name)
      expect(stillDueRow.intervalMs).toBe(3_600_000)
      expect(stillDueRow.nextRunAt.getTime()).toBeLessThanOrEqual(stillDueRow.databaseNow.getTime())
    })

    it('11. reconciling during a live lease updates the cadence but not the schedule or the lease', async () => {
      const name = taskName('reconcile-live-lease')
      await makeDue(name)

      const beforeClaim = await healthOf(name)
      const nextRunBeforeClaim = beforeClaim.nextRunAt.getTime()

      const claim = await claimOrThrow({ name, leaseMs: 60_000, owner: 'suite' })

      // Reconcile the same name with a different interval while the lease
      // is held.
      await store.reconcile([{ name, intervalMs: 3_600_000 }])

      const duringLease = await healthOf(name)
      expect(duringLease.intervalMs).toBe(3_600_000)
      // next_run_at is untouched by reconcile while a lease is live.
      expect(duringLease.nextRunAt.getTime()).toBe(nextRunBeforeClaim)
      // The lease itself is provably still live at this point — a
      // reconcile that had (incorrectly) cleared or expired it would flip
      // this to true.
      expect(duringLease.leaseExpired).toBe(false)

      // The proof that the lease itself (lease_token) is untouched:
      // `complete` with the ORIGINAL token must still succeed.
      // `RecurringTaskHealth` has no lease-token field to inspect
      // directly, so this is proven behaviourally rather than by reading
      // a column.
      const completed = await store.complete({
        name,
        leaseToken: claim.leaseToken,
        durationMs: 5,
        workRemaining: false,
      })
      expect(completed).toBe(true)

      // This is the whole point of the case: the resulting next_run_at
      // reflects the NEW interval reconciled mid-lease, not the one in
      // force when the claim was taken — the rolling-deploy scenario in
      // miniature, and the reason `complete` reads the persisted column
      // instead of accepting an interval from the runner.
      const afterComplete = await healthOf(name)
      assertClose(
        afterComplete.nextRunAt,
        afterComplete.databaseNow.getTime() + 3_600_000,
        'post-reconcile interval on complete'
      )
    })

    it('12. health reports a currently expired lease as leaseExpired with lastStatus running', async () => {
      const name = taskName('health-expired-lease')
      await makeDue(name)

      await claimOrThrow({ name, leaseMs: 100, owner: 'suite' })

      await sleep(150)

      const row = await healthOf(name)
      expect(row.leaseExpired).toBe(true)
      expect(row.lastStatus).toBe('running')
    })

    it('health() reads: omitted, one name, several names, and an empty array all filter correctly', async () => {
      const nameA = taskName('health-shapes-a')
      const nameB = taskName('health-shapes-b')

      await store.reconcile([
        { name: nameA, intervalMs: 3_600_000 },
        { name: nameB, intervalMs: 3_600_000 },
      ])

      // Omitted -> every row, including both seeded ones.
      const all = await store.health()
      const allNames = all.map((row) => row.name)
      expect(allNames).toEqual(expect.arrayContaining([nameA, nameB]))

      // One name.
      const one = await store.health([nameA])
      expect(one.map((row) => row.name)).toEqual([nameA])

      // Several names.
      const several = await store.health([nameA, nameB])
      expect(several.map((row) => row.name).sort()).toEqual([nameA, nameB].sort())

      // Empty array must filter to nothing — not the same as "omitted".
      // This is where array-binding SQL generation most commonly breaks
      // (e.g. an empty `= ANY(...)` array silently treated as "no filter").
      const none = await store.health([])
      expect(none).toEqual([])
    })
  })
}
