/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Serialization adapter for coded errors thrown from server fns.
 *
 * TanStack Start's default `ShallowErrorPlugin` matches any `Error` and
 * serialises only `message` — `code`, `cause`, and custom fields are
 * dropped on the wire. That makes client-side branching on `err.code`
 * dead code: every failure reaches the caller as a plain `Error(message)`.
 *
 * This adapter is registered via `createStart(...)` in `src/start.ts`.
 * TanStack prepends `serializationAdapters` before the default plugins,
 * so our `test` matches first and our errors skip the shallow fallback.
 *
 * The adapter is intentionally duck-typed (`name + code`) rather than
 * using `instanceof AdminUsersError` / `instanceof AuthError`. Both error
 * classes live in packages whose barrel exports pull argon2 / other
 * server-only code into whatever bundle imports them — a direct import
 * here would drag that into the browser bundle. The string check is
 * equally reliable in practice and keeps this module client-safe.
 *
 * On the client side we rebuild the error as `BylineCodedError` — a
 * lightweight local class that preserves `name`, `code`, and `message`.
 * The admin forms branch on `err.code === '...'` (string), not on the
 * original class, so the UI behaves identically to a real throw.
 */

import { createSerializationAdapter } from '@tanstack/react-router'

/**
 * Names of server-side error classes we want to preserve across the
 * server-fn boundary. Add a new entry when introducing another typed
 * error class that carries a string `code`.
 */
const CODED_ERROR_NAMES = new Set(['AdminUsersError', 'AuthError'])

export interface BylineCodedErrorPayload {
  name: string
  code: string
  message: string
}

/**
 * Minimal `Error` subclass reconstructed on the deserialize side. Does
 * not reference the original server-side classes — intentional, to keep
 * this module free of server-only dependencies.
 */
export class BylineCodedError extends Error {
  public readonly code: string

  constructor(payload: BylineCodedErrorPayload) {
    super(payload.message)
    this.name = payload.name
    this.code = payload.code
  }
}

function isCodedError(value: unknown): value is Error & { code: string } {
  if (!(value instanceof Error)) return false
  if (!CODED_ERROR_NAMES.has(value.name)) return false
  const code = (value as { code?: unknown }).code
  return typeof code === 'string'
}

export const bylineCodedErrorAdapter = createSerializationAdapter({
  key: 'BylineCodedError',
  test: isCodedError,
  toSerializable: (err): BylineCodedErrorPayload => ({
    name: err.name,
    code: err.code,
    message: err.message,
  }),
  fromSerializable: (payload: BylineCodedErrorPayload) => new BylineCodedError(payload),
})
