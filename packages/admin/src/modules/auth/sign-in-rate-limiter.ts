/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

import type { PasswordSignInLimiter } from '@byline/auth'
import type { RecurringTaskDefinition } from '@byline/core'

export interface SignInRateLimitStore {
  /** Atomically increment, saturating at limit + 1; true only for the first limit calls. */
  consume(key: string, limit: number, expiresAt: Date): Promise<boolean>
  /** Remove at most 100 expired counters and return the number removed. */
  purgeExpired(before: Date): Promise<number>
}

export interface SignInRateLimitPolicy {
  account: { limit: number; windowSeconds: number }
  ip: { limit: number; windowSeconds: number }
}

export interface SignInSecurityEvent {
  type: 'admitted' | 'denied' | 'capacity' | 'store-error' | 'cleanup-error' | 'success' | 'failure'
  scope?: 'account' | 'ip'
  /** Stable, pseudonymous digests for cross-network correlation. Never passwords or raw IPs. */
  account?: string
  network?: string
}

export interface SignInLimiterOptions {
  onEvent?: (event: SignInSecurityEvent) => void
  slots?: number
  maxQueue?: number
  queueTimeoutMs?: number
  /** Also bounds counter creation when the provider or a denial completes very quickly. */
  minimumSlotMs?: number
}

const DEFAULT_POLICY: SignInRateLimitPolicy = {
  account: { limit: 10, windowSeconds: 15 * 60 },
  ip: { limit: 60, windowSeconds: 60 },
}
const CLEANUP_TASK_NAME = 'auth.sign-in-counters.cleanup'

/** IPv4 uses one address; IPv6 uses its /64. Mapped IPv4 shares its native IPv4 bucket. */
function signInNetwork(ip: string): string {
  const version = isIP(ip)
  if (version === 4) return ip
  if (version !== 6 || ip.includes('%')) throw new Error('Invalid client address')
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1)
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical)
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16)
    const low = Number.parseInt(mapped[2]!, 16)
    return [high >>> 8, high & 255, low >>> 8, low & 255].join('.')
  }
  const [left, right] = canonical.split('::')
  const head = left ? left.split(':') : []
  const tail = right ? right.split(':') : []
  const words =
    right === undefined
      ? head
      : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
  return `${words.slice(0, 4).join(':')}::/64`
}

/**
 * Instantiate once per process. Acquire before consume and release in finally after verification.
 * Network admission precedes account-plus-network admission. There is no account-wide lockout.
 */
export function createPasswordSignInLimiter(
  store: SignInRateLimitStore,
  secret: string | Uint8Array,
  policy: SignInRateLimitPolicy = DEFAULT_POLICY,
  now: () => number = Date.now,
  options: SignInLimiterOptions = {}
): PasswordSignInLimiter & { cleanupTask: RecurringTaskDefinition; dispose(): void } {
  const secretBytes = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret
  if (secretBytes.byteLength < 32)
    throw new Error('Sign-in HMAC secret must contain at least 32 bytes')
  // Domain separation permits reuse of the installation JWT secret without reusing its signing key.
  const key = createHmac('sha256', secretBytes).update('byline:password-sign-in:v1').digest()
  const digest = (value: unknown) =>
    createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
  const rules = structuredClone(policy)
  for (const rule of Object.values(rules)) {
    if (
      !Number.isSafeInteger(rule.limit) ||
      rule.limit < 1 ||
      rule.limit > 1_000_000 ||
      !Number.isSafeInteger(rule.windowSeconds) ||
      rule.windowSeconds < 1 ||
      rule.windowSeconds > 86400
    )
      throw new Error('Invalid password sign-in rate limit policy')
  }
  const slots = options.slots ?? 1
  const maxQueue = options.maxQueue ?? 4
  const queueTimeoutMs = options.queueTimeoutMs ?? 250
  const minimumSlotMs = options.minimumSlotMs ?? 100
  for (const value of [slots, queueTimeoutMs, minimumSlotMs])
    if (!Number.isSafeInteger(value) || value < 1 || value > 60_000)
      throw new Error('Invalid sign-in capacity policy')
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 0 || maxQueue > 1000)
    throw new Error('Invalid sign-in queue size')
  const diagnostics = new Map<string, { last: number; count: number }>()
  const emit = (event: SignInSecurityEvent) => {
    // Observability must not change admission or strand a capacity lease.
    try {
      if (options.onEvent) options.onEvent(event)
      else if (event.type !== 'admitted' && event.type !== 'success') {
        const entry = diagnostics.get(event.type) ?? { last: -Infinity, count: 0 }
        entry.count++
        if (performance.now() - entry.last >= 10_000) {
          console.warn('[byline:password-sign-in]', { ...event, count: entry.count })
          entry.last = performance.now()
          entry.count = 0
        }
        diagnostics.set(event.type, entry)
      }
    } catch {
      /* Host telemetry is best effort. */
    }
  }
  const identifiers = ({ email, ip }: { email: string; ip: string }) => ({
    account: digest(['account', email.trim().toLowerCase()]),
    network: digest(['network', signInNetwork(ip)]),
  })
  let active = 0
  let disposed = false
  const queue: Array<{ grant: () => void; cancel: () => void }> = []
  const lease = (): (() => void) => {
    active++
    const started = performance.now()
    let released = false
    return () => {
      if (released) return
      released = true
      // Keep the slot occupied for at least this interval, including fast denials.
      setTimeout(
        () => {
          active--
          queue.shift()?.grant()
        },
        Math.max(0, minimumSlotMs - (performance.now() - started))
      ).unref()
    }
  }
  const cleanupTask: RecurringTaskDefinition = {
    name: CLEANUP_TASK_NAME,
    intervalMs: 60_000,
    leaseMs: 60_000,
    async run(context) {
      const cutoff = new Date(now() - 300_000)
      try {
        for (let batch = 0; batch < 32; batch++) {
          context.signal.throwIfAborted()
          await context.heartbeat()
          if ((await store.purgeExpired(cutoff)) < 100) return { workRemaining: false }
        }
        return { workRemaining: true }
      } catch (error) {
        emit({ type: 'cleanup-error' })
        // Let the scheduler record the failure and apply its retry/backoff policy.
        throw error
      }
    },
  }
  return {
    requiredCleanupTask: CLEANUP_TASK_NAME,
    cleanupTask,
    dispose() {
      disposed = true
      for (const waiter of queue.splice(0)) waiter.cancel()
    },
    async acquire() {
      if (disposed) throw new Error('Sign-in limiter disposed')
      if (active < slots) return lease()
      if (queue.length >= maxQueue) {
        emit({ type: 'capacity' })
        return null
      }
      return new Promise<(() => void) | null>((resolve) => {
        const waiter = {
          grant: () => {
            clearTimeout(timeout)
            resolve(lease())
          },
          cancel: () => {
            clearTimeout(timeout)
            emit({ type: 'capacity' })
            resolve(null)
          },
        }
        const timeout = setTimeout(() => {
          queue.splice(queue.indexOf(waiter), 1)
          waiter.cancel()
        }, queueTimeoutMs)
        queue.push(waiter)
      })
    },
    recordResult(input, outcome) {
      emit({ type: outcome, ...identifiers(input) })
    },
    async consume(input) {
      const time = now()
      const network = signInNetwork(input.ip)
      const ids = identifiers(input)
      try {
        // Load-proportional cleanup stays on the request path; the scheduler drains idle residue.
        await store.purgeExpired(new Date(time - 300_000))
        for (const [scope, identity] of [
          ['ip', network],
          ['account', [input.email.trim().toLowerCase(), network]],
        ] as const) {
          const rule = rules[scope]
          const windowMs = rule.windowSeconds * 1000
          const end = (Math.floor(time / windowMs) + 1) * windowMs
          if (!(await store.consume(digest([scope, identity, end]), rule.limit, new Date(end)))) {
            emit({ type: 'denied', scope, ...ids })
            return {
              allowed: false,
              retryAfterSeconds: Math.max(1, Math.ceil((end - time) / 1000)),
            }
          }
        }
        emit({ type: 'admitted', ...ids })
        return { allowed: true, retryAfterSeconds: 0 }
      } catch (error) {
        emit({ type: 'store-error', ...ids })
        throw error
      }
    },
  }
}
