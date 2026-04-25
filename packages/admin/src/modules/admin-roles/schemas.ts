/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { uuidSchema } from '@byline/core/validation'
import { z } from 'zod'

/**
 * Zod request/response schemas for the admin-roles commands.
 *
 * `vid` gates writes for optimistic concurrency; `machine_name` is
 * accepted only at create time and validated as a slug-shaped string.
 *
 * Reorder takes the full ordered id list — the index in the array
 * becomes each role's new `order` value. The list-view UX is "drag,
 * then save the whole order" so a partial-update payload would add no
 * value and complicate atomicity.
 */

// ---------------------------------------------------------------------------
// Field-level schemas
// ---------------------------------------------------------------------------

const idSchema = uuidSchema

const vidSchema = z
  .number({ message: 'vid is required' })
  .int({ message: 'vid must be an integer' })
  .positive({ message: 'vid must be positive' })

const nameSchema = z.string().min(1).max(128)

const machineNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, {
    message: 'machine_name may contain lowercase letters, numbers, hyphens, and underscores only',
  })

const descriptionSchema = z.string().max(2000).nullish()

const orderSchema = z.number().int().min(0)

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const listAdminRolesRequestSchema = z.object({}).optional()
export type ListAdminRolesRequest = z.infer<typeof listAdminRolesRequestSchema>

export const getAdminRoleRequestSchema = z.object({
  id: idSchema,
})
export type GetAdminRoleRequest = z.infer<typeof getAdminRoleRequestSchema>

export const createAdminRoleRequestSchema = z.object({
  name: nameSchema,
  machine_name: machineNameSchema,
  description: descriptionSchema,
  order: orderSchema.optional(),
})
export type CreateAdminRoleRequest = z.infer<typeof createAdminRoleRequestSchema>

export const updateAdminRoleRequestSchema = z.object({
  id: idSchema,
  vid: vidSchema,
  patch: z
    .object({
      name: nameSchema.optional(),
      description: descriptionSchema,
      order: orderSchema.optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch cannot be empty' }),
})
export type UpdateAdminRoleRequest = z.infer<typeof updateAdminRoleRequestSchema>

export const deleteAdminRoleRequestSchema = z.object({
  id: idSchema,
  vid: vidSchema,
})
export type DeleteAdminRoleRequest = z.infer<typeof deleteAdminRoleRequestSchema>

export const reorderAdminRolesRequestSchema = z.object({
  ids: z.array(idSchema).min(1, { message: 'at least one id is required' }),
})
export type ReorderAdminRolesRequest = z.infer<typeof reorderAdminRolesRequestSchema>

export const getRolesForUserRequestSchema = z.object({
  userId: idSchema,
})
export type GetRolesForUserRequest = z.infer<typeof getRolesForUserRequestSchema>

export const setRolesForUserRequestSchema = z.object({
  userId: idSchema,
  roleIds: z.array(idSchema),
})
export type SetRolesForUserRequest = z.infer<typeof setRolesForUserRequestSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const adminRoleResponseSchema = z.object({
  id: z.string(),
  vid: z.number().int(),
  name: z.string(),
  machine_name: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
  created_at: z.date(),
  updated_at: z.date(),
})
export type AdminRoleResponse = z.infer<typeof adminRoleResponseSchema>

export const adminRoleListResponseSchema = z.object({
  roles: z.array(adminRoleResponseSchema),
})
export type AdminRoleListResponse = z.infer<typeof adminRoleListResponseSchema>

/**
 * User-roles editor payload. `userId` is echoed back so the caller can
 * match async writes; `roles` is the authoritative role-set after the
 * write, shaped as full role rows so the drawer renders names without a
 * second fetch.
 */
export const userRolesResponseSchema = z.object({
  userId: z.string(),
  roles: z.array(adminRoleResponseSchema),
})
export type UserRolesResponse = z.infer<typeof userRolesResponseSchema>

/** Empty response for void-returning mutations (delete, reorder). */
export const okResponseSchema = z.object({ ok: z.literal(true) })
export type OkResponse = z.infer<typeof okResponseSchema>
