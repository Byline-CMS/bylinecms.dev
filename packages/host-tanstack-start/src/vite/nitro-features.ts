/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The Nitro `features` a Byline host must run with, merged over any features
 * the host sets itself.
 *
 * Use it as the `features` option of the `nitro()` Vite plugin:
 *
 * ```ts
 * nitro({ preset: 'node', features: bylineNitroFeatures({ websocket: true }) })
 * ```
 *
 * `fastResponse: false` — Nitro 3 release candidates replace the global
 * `Response` with srvx's `FastResponse` on Node. srvx 1.0.8 loses the status of
 * a Response copied with `new Response(response.body, response)` once the
 * copy's headers are touched, and TanStack Start copies every Response a
 * server function throws in exactly that way. Byline's sign-in and passkey
 * server functions throw 400, 404, 429 and 503 Responses, which would reach the
 * browser as 200. See https://github.com/h3js/srvx/issues/343. Byline overrides
 * a host's own `fastResponse` value, because no value but `false` is safe until
 * a fixed srvx release reaches Nitro. Removal is tracked in
 * https://github.com/Byline-CMS/bylinecms.dev/issues/112.
 */
export function bylineNitroFeatures<T extends object>(
  features?: T
): Omit<T, 'fastResponse'> & { fastResponse: false } {
  return { ...(features as T), fastResponse: false }
}
