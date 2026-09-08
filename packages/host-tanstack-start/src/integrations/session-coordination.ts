/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Browser coordination metadata only. No access or refresh credentials are exposed to JavaScript. */
const storageKey = 'byline.expected-login'
let expected: string | null = null
let epoch = 0
let changed = false
let renewal: Promise<void> | undefined
const listeners = new Set<() => void>()
export const sessionChangedError = () =>
  new Error('Session changed. Acknowledge the active account before continuing.')
export function expectedSession() {
  if (typeof window === 'undefined') return null
  if (!expected) expected = window.sessionStorage.getItem(storageKey)
  return expected
}
export function sessionSnapshot() {
  return { sessionId: expectedSession(), epoch }
}
export function requireUnchanged(snapshot: ReturnType<typeof sessionSnapshot>) {
  if (changed || snapshot.epoch !== epoch || snapshot.sessionId !== expectedSession())
    throw sessionChangedError()
}
export function flagSessionChanged() {
  changed = true
  epoch++
  for (const listener of listeners) listener()
}
export function acceptSession(sessionId: string) {
  if (typeof window === 'undefined') return
  if (typeof sessionId !== 'string' || !sessionId)
    throw new Error('Provider omitted login identity')
  window.sessionStorage.setItem(storageKey, sessionId)
  expected = sessionId
  changed = false
  epoch++
  for (const listener of listeners) listener()
}
export function observeSession(sessionId: string) {
  const old = expectedSession()
  if (old && old !== sessionId) {
    flagSessionChanged()
    throw sessionChangedError()
  }
  if (!old) acceptSession(sessionId)
}
export function sessionEpoch() {
  return epoch
}
export function sessionIsChanged() {
  return changed
}
export function subscribeSessionChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function renewSingleFlight(work: () => Promise<void>) {
  if (!renewal)
    renewal = work().finally(() => {
      renewal = undefined
    })
  return renewal
}

let authQueue: Promise<unknown> = Promise.resolve()
export function coordinateAuthAction<T>(work: () => Promise<T>): Promise<T> {
  const run = authQueue
    .catch(() => {})
    .then(async () => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request('byline.auth', work)
      return work()
    })
  authQueue = run
  return run
}
let channel: BroadcastChannel | undefined
export function startSessionNotifications() {
  if (typeof BroadcastChannel === 'undefined' || channel) return
  channel = new BroadcastChannel('byline.session')
  channel.onmessage = () => {
    flagSessionChanged()
  }
}
export function notifySessionAction() {
  startSessionNotifications()
  channel?.postMessage({ type: 'session-changed' })
}
