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
  .min(8, 'Password must be at least 8 characters long.')
  .max(128, 'Password must not exceed 128 characters.')
  .regex(
    /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one character from the following: #?!@$%^&*-'
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
