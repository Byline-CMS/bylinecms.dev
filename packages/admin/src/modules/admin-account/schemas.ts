/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Zod schemas for the admin-account commands.
 *
 * Self-service is intentionally narrower than admin-users:
 *
 *   - The actor IS the target. None of the request schemas accept an
 *     `id` field — the command resolves the target from
 *     `actor.id`. Persisting `id` in the request shape would
 *     immediately invite "but what if I pass someone else's id?"
 *     mistakes downstream.
 *   - The update patch excludes `is_super_admin`, `is_enabled`, and
 *     `is_email_verified`. Self-service must never let a user grant
 *     themselves super-admin or flip their own enabled state. Those
 *     fields stay editable through the admin-users module by an admin
 *     who holds the relevant ability.
 *   - `changePassword` requires the *current* password as a defence
 *     against session-hijack abuse: an attacker with a stolen session
 *     cookie still needs the password they don't have to swap it out.
 *
 * The response shape is the same as `adminUserResponseSchema` so the
 * admin-account UI and the admin-users UI render the same row shape
 * — re-exported here for convenience.
 */

import { passwordSchema } from '@byline/core/validation'
import { z } from 'zod'

import { adminUserResponseSchema, okResponseSchema } from '../admin-users/schemas.js'

const vidSchema = z
  .number({ message: 'vid is required' })
  .int({ message: 'vid must be an integer' })
  .positive({ message: 'vid must be positive' })

const emailSchema = z
  .email({ message: 'email must be a valid address' })
  .min(3)
  .max(254)
  .transform((v) => v.toLowerCase())

const nameSchema = z.string().min(1).max(100)

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** No payload — target is the actor on context. */
export const getAccountRequestSchema = z.object({}).strict()
export type GetAccountRequest = z.infer<typeof getAccountRequestSchema>

export const updateAccountRequestSchema = z.object({
  vid: vidSchema,
  patch: z
    .object({
      email: emailSchema.optional(),
      given_name: nameSchema.nullish(),
      family_name: nameSchema.nullish(),
      username: z.string().min(1).max(100).nullish(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch cannot be empty' }),
})
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>

export const changeAccountPasswordRequestSchema = z.object({
  vid: vidSchema,
  currentPassword: z.string().min(1, { message: 'current password is required' }),
  newPassword: passwordSchema,
})
export type ChangeAccountPasswordRequest = z.infer<typeof changeAccountPasswordRequestSchema>

// ---------------------------------------------------------------------------
// Responses (re-exports — same shape as the admin-users module)
// ---------------------------------------------------------------------------

export { adminUserResponseSchema as accountResponseSchema, okResponseSchema }
export type { AdminUserResponse as AccountResponse, OkResponse } from '../admin-users/schemas.js'
