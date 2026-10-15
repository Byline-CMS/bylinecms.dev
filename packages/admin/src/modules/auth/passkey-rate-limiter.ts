/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHmac } from 'node:crypto'

import type { PasskeyRequestLimiter } from '@byline/auth'
import type { RecurringTaskDefinition } from '@byline/core'

import { type SignInRateLimitStore, signInNetwork } from './sign-in-rate-limiter.js'

/** Separate WebAuthn capacity and key domain; counter storage and cleanup are shared. */
export function createPasskeyRequestLimiter(
  store: SignInRateLimitStore,
  secret: string | Uint8Array,
  now: () => number = Date.now
): PasskeyRequestLimiter & { cleanupTask: RecurringTaskDefinition } {
  const bytes = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret
  if (bytes.byteLength < 32) throw new Error('Passkey HMAC secret must contain at least 32 bytes')
  const key = createHmac('sha256', bytes).update('byline:passkey-requests:v1').digest()
  let active = 0
  const cleanupTask: RecurringTaskDefinition = {
    // Both limiters use the same counter table; register this task only once.
    name: 'auth.sign-in-counters.cleanup',
    intervalMs: 60_000,
    leaseMs: 60_000,
    async run(context) {
      const started = performance.now()
      for (let n = 0; n < 32 && performance.now() - started < 30_000; n++) {
        context.signal.throwIfAborted()
        await context.heartbeat()
        if ((await store.purgeExpired(new Date(now() - 300_000))) < 100)
          return { workRemaining: false }
      }
      return { workRemaining: true }
    },
  }
  return {
    requiredCleanupTask: cleanupTask.name,
    cleanupTask,
    async acquire() {
      if (active >= 4) return null
      active++
      const started = performance.now()
      let released = false
      return () => {
        if (released) return
        released = true
        setTimeout(
          () => {
            active--
          },
          Math.max(0, 100 - (performance.now() - started))
        ).unref()
      }
    },
    async consume({ ip }) {
      const network = signInNetwork(ip)
      const time = now()
      const end = (Math.floor(time / 60_000) + 1) * 60_000
      const digest = createHmac('sha256', key)
        .update(JSON.stringify(['network', network, end]))
        .digest('hex')
      await store.purgeExpired(new Date(time - 300_000))
      const allowed = await store.consume(digest, 60, new Date(end))
      return {
        allowed,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((end - time) / 1000)),
      }
    },
  }
}
