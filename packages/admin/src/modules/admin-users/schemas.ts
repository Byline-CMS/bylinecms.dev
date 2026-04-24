/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { z } from 'zod'

/**
 * Zod request/response schemas for the admin-users commands.
 *
 * Both input and output are validated — response validation keeps the
 * admin surface honest about what it promises downstream clients. The
 * DTO shaper in `dto.ts` produces values that match `adminUserResponseSchema`
 * exactly; if the schema or the DTO drifts, tests catch it at the
 * command boundary.
 *
 * `vid` is the optimistic-concurrency version — every write that touches
 * content content takes the client-held `vid` and the adapter gates the
 * write on it, throwing `ADMIN_USER_VERSION_CONFLICT` on mismatch.
 */

// ---------------------------------------------------------------------------
// Field-level schemas (re-used across requests)
// ---------------------------------------------------------------------------

const idSchema = z.uuid({ message: 'id must be a UUID' })

const vidSchema = z
  .number({ message: 'vid is required' })
  .int({ message: 'vid must be an integer' })
  .positive({ message: 'vid must be positive' })

const emailSchema = z
  .email({ message: 'email must be a valid address' })
  .min(3)
  .max(254)
  .transform((v) => v.toLowerCase())

/**
 * Password policy for admin-user passwords. Minimum 12 chars keeps us
 * above OWASP's 2023 recommendation for administrative accounts. Upper
 * bound caps argon2 input; hashing a 1 MiB password is a DoS vector.
 */
const passwordSchema = z
  .string({ message: 'password is required' })
  .min(12, 'password must be at least 12 characters')
  .max(256, 'password must not exceed 256 characters')

const nameSchema = z.string().min(1).max(100)

const orderSchema = z.enum([
  'given_name',
  'family_name',
  'email',
  'username',
  'created_at',
  'updated_at',
])

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const listAdminUsersRequestSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
  query: z.string().max(128).optional(),
  order: orderSchema.optional().default('created_at'),
  desc: z.boolean().optional().default(true),
})
export type ListAdminUsersRequest = z.infer<typeof listAdminUsersRequestSchema>

export const getAdminUserRequestSchema = z.object({
  id: idSchema,
})
export type GetAdminUserRequest = z.infer<typeof getAdminUserRequestSchema>

export const createAdminUserRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  given_name: nameSchema.nullish(),
  family_name: nameSchema.nullish(),
  username: z.string().min(1).max(100).nullish(),
  is_super_admin: z.boolean().optional(),
  is_enabled: z.boolean().optional(),
  is_email_verified: z.boolean().optional(),
})
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>

export const updateAdminUserRequestSchema = z.object({
  id: idSchema,
  vid: vidSchema,
  patch: z
    .object({
      email: emailSchema.optional(),
      given_name: nameSchema.nullish(),
      family_name: nameSchema.nullish(),
      username: z.string().min(1).max(100).nullish(),
      is_super_admin: z.boolean().optional(),
      is_enabled: z.boolean().optional(),
      is_email_verified: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch cannot be empty' }),
})
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>

export const setAdminUserPasswordRequestSchema = z.object({
  id: idSchema,
  vid: vidSchema,
  password: passwordSchema,
})
export type SetAdminUserPasswordRequest = z.infer<typeof setAdminUserPasswordRequestSchema>

export const enableAdminUserRequestSchema = z.object({ id: idSchema })
export type EnableAdminUserRequest = z.infer<typeof enableAdminUserRequestSchema>

export const disableAdminUserRequestSchema = z.object({ id: idSchema })
export type DisableAdminUserRequest = z.infer<typeof disableAdminUserRequestSchema>

export const deleteAdminUserRequestSchema = z.object({
  id: idSchema,
  vid: vidSchema,
})
export type DeleteAdminUserRequest = z.infer<typeof deleteAdminUserRequestSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Public shape of an admin user. Deliberately excludes `password_hash` —
 * the DTO in `dto.ts` is responsible for producing exactly this shape
 * from an `AdminUserRow`, so the schema acts as a contract check.
 */
export const adminUserResponseSchema = z.object({
  id: z.string(),
  vid: z.number().int(),
  email: z.string(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  username: z.string().nullable(),
  remember_me: z.boolean(),
  last_login: z.date().nullable(),
  last_login_ip: z.string().nullable(),
  failed_login_attempts: z.number().int(),
  is_super_admin: z.boolean(),
  is_enabled: z.boolean(),
  is_email_verified: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
})
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserResponseSchema),
  meta: z.object({
    total: z.number().int().min(0),
    total_pages: z.number().int().min(0),
    page: z.number().int().min(1),
    page_size: z.number().int().min(1),
    query: z.string(),
    order: orderSchema,
    desc: z.boolean(),
  }),
})
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>

/** Empty response for void-returning mutations (set-password, enable, disable, delete). */
export const okResponseSchema = z.object({ ok: z.literal(true) })
export type OkResponse = z.infer<typeof okResponseSchema>
