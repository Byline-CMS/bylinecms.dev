/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The host-framework request bridge — the seam that makes the server-side
 * client stack (`@byline/client/server`) host-agnostic.
 *
 * Everything request-scoped in that stack bottoms out in three
 * primitives: "which request am I in" (identity for per-request
 * memoization), "read a cookie", and "write a cookie" (admin session
 * refresh rotates tokens). A host adapter implements those three over its
 * framework's runtime and registers the bridge once at server boot;
 * `@byline/client/server` is written against the interface and never
 * imports a framework.
 *
 * Registration follows the same pattern as the config singletons in
 * `config/config.ts`: a `Symbol.for` slot on `globalThis`, so every copy
 * of this module (Vite SSR can resolve workspace-linked packages through
 * different module graphs) shares the same state. Server-only by nature —
 * hosts register from their boot path (side-effect imports guarantee
 * registration before any request is handled), and nothing in a browser
 * graph should ever reach for it.
 */

export interface HostCookieSetOptions {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  path?: string
  maxAge?: number
}

export interface HostRequestBridge {
  /**
   * A stable identity object for the current HTTP request, or `undefined`
   * when running outside a request (seed scripts, background jobs, unit
   * tests). Used purely as a WeakMap key for per-request memoization —
   * never inspected.
   */
  getRequest(): object | undefined
  /** Read a request cookie. Returns `undefined` when not present. */
  getCookie(name: string): string | undefined
  /** Write a response cookie (admin session refresh, preview toggles). */
  setCookie(name: string, value: string, options?: HostCookieSetOptions): void
}

const BYLINE_HOST_REQUEST_BRIDGE = Symbol.for('__byline_host_request_bridge__')

/**
 * Register the host adapter's bridge. Idempotent and last-write-wins —
 * host adapters register from side-effect imports, which may evaluate
 * more than once across module graphs.
 */
export function registerHostRequestBridge(bridge: HostRequestBridge): void {
  ;(globalThis as any)[BYLINE_HOST_REQUEST_BRIDGE] = bridge
}

/** The registered bridge, or `undefined` when no host has registered one. */
export function tryGetHostRequestBridge(): HostRequestBridge | undefined {
  return (globalThis as any)[BYLINE_HOST_REQUEST_BRIDGE] ?? undefined
}

/**
 * The registered bridge, throwing with setup guidance when absent. Cookie
 * reads/writes require a host; scripts and tests that have no request
 * should pass an explicit `requestContext` to `createBylineClient`
 * instead of using the request-bound getters.
 */
export function getHostRequestBridge(): HostRequestBridge {
  const bridge = tryGetHostRequestBridge()
  if (!bridge) {
    throw new Error(
      'No HostRequestBridge registered. A host adapter (e.g. ' +
        '@byline/host-tanstack-start) must call registerHostRequestBridge() ' +
        'at server boot before request-bound client getters can resolve ' +
        'cookies. Scripts and tests should pass an explicit requestContext ' +
        'to createBylineClient instead.'
    )
  }
  return bridge
}
