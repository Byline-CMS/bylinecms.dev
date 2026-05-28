/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Generic Zod helpers shared across packages.
 *
 * Kept separate from `@byline/core/zod-schemas` (which hosts the
 * collection-builder Zod machinery) so the purpose of each subpath
 * stays clear. Ported from `@infonomic/shared` — the organisation's
 * standard schema set, re-declared here so Byline has no external
 * dependency on that package.
 *
 * Pure Zod — no runtime side effects, client-safe.
 */

import { z } from 'zod'

/**
 * Stable error codes emitted by `passwordSchema`. The schema yields
 * these as the Zod issue message rather than free-form English so
 * client callers can translate them at render time. Server-side
 * consumers that don't translate (the defensive request-shape
 * validation in admin command handlers) will see the code itself —
 * acceptable because the form-level validation catches the same
 * case first, so the server message is only surfaced when a
 * malformed payload reaches the API outside the normal flow.
 *
 * Adding a new code: extend the union and add a matching key in the
 * admin-side translator map (`@byline/admin/lib/translate-validation-error`).
 * The same map shape is the recommended pattern for future schemas in
 * this file — emit codes here, translate in `@byline/admin`.
 */
export const PASSWORD_ERROR_CODES = {
  TOO_SHORT: 'password.tooShort',
  TOO_LONG: 'password.tooLong',
  COMPLEXITY: 'password.complexity',
} as const

/**
 * Standard password policy — 8 to 128 characters, must contain at least
 * one uppercase, one lowercase, one digit, and one character from the
 * set `#?!@$%^&*-`. The 128-char cap leaves room for passphrase-style
 * entries while still bounding argon2 input size (hashing a 1 MiB
 * password is a DoS vector). The regex runs after `.min` / `.max` so
 * the user sees length errors first and character-class errors only
 * once length is acceptable.
 */
export const passwordSchema = z
  .string()
  .min(8, PASSWORD_ERROR_CODES.TOO_SHORT)
  .max(128, PASSWORD_ERROR_CODES.TOO_LONG)
  .regex(
    /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/,
    PASSWORD_ERROR_CODES.COMPLEXITY
  )

/**
 * UUID with a descriptive error message. Equivalent to `z.uuid()` but
 * the message is caller-friendly for forms that surface field errors
 * directly.
 */
export const uuidSchema = z.uuid({
  message:
    'Invalid UUID format. Must be a 36-character hex string with hyphens (e.g., 123e4567-e89b-12d3-a456-426614174000)',
})
