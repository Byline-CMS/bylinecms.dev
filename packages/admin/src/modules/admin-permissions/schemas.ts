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
 * Zod request/response schemas for the admin-permissions inspector.
 *
 * The inspector ships two endpoints:
 *
 *   - `listRegisteredAbilities` — flat list + grouped buckets straight
 *     out of the `AbilityRegistry`. No DB read.
 *   - `whoHasAbility` — for a given ability key, the list of roles that
 *     grant it and the distinct list of admin users transitively
 *     holding it. Two DB joins.
 *
 * Phase B will add `getRoleAbilities` / `setRoleAbilities` for the
 * per-role editor on the admin-roles detail page; both are deliberately
 * out of scope here.
 */

const abilityKeySchema = z.string().min(1).max(128)

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const listRegisteredAbilitiesRequestSchema = z.object({}).optional()
export type ListRegisteredAbilitiesRequest = z.infer<typeof listRegisteredAbilitiesRequestSchema>

export const whoHasAbilityRequestSchema = z.object({
  ability: abilityKeySchema,
})
export type WhoHasAbilityRequest = z.infer<typeof whoHasAbilityRequestSchema>

export const getRoleAbilitiesRequestSchema = z.object({
  id: uuidSchema,
})
export type GetRoleAbilitiesRequest = z.infer<typeof getRoleAbilitiesRequestSchema>

export const setRoleAbilitiesRequestSchema = z.object({
  id: uuidSchema,
  abilities: z.array(abilityKeySchema),
})
export type SetRoleAbilitiesRequest = z.infer<typeof setRoleAbilitiesRequestSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const abilitySourceSchema = z.enum(['collection', 'plugin', 'core', 'admin']).nullable()

export const abilityDescriptorResponseSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  group: z.string(),
  source: abilitySourceSchema,
})
export type AbilityDescriptorResponse = z.infer<typeof abilityDescriptorResponseSchema>

export const abilityGroupResponseSchema = z.object({
  group: z.string(),
  abilities: z.array(abilityDescriptorResponseSchema),
})
export type AbilityGroupResponse = z.infer<typeof abilityGroupResponseSchema>

/**
 * Inspector list payload. Returns both the flat list and the grouped
 * buckets so the UI can render either shape without re-bucketing.
 */
export const listRegisteredAbilitiesResponseSchema = z.object({
  abilities: z.array(abilityDescriptorResponseSchema),
  groups: z.array(abilityGroupResponseSchema),
  total: z.number().int().min(0),
})
export type ListRegisteredAbilitiesResponse = z.infer<typeof listRegisteredAbilitiesResponseSchema>

/**
 * Who-has-ability matrix entry. Roles and users are surfaced in the
 * same response so the inline-expand row in the inspector renders in
 * one round-trip.
 */
export const abilityHolderRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  machine_name: z.string(),
})
export type AbilityHolderRole = z.infer<typeof abilityHolderRoleSchema>

export const abilityHolderUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
})
export type AbilityHolderUser = z.infer<typeof abilityHolderUserSchema>

export const whoHasAbilityResponseSchema = z.object({
  ability: z.string(),
  roles: z.array(abilityHolderRoleSchema),
  users: z.array(abilityHolderUserSchema),
})
export type WhoHasAbilityResponse = z.infer<typeof whoHasAbilityResponseSchema>

/**
 * Editor payloads. `roleId` is echoed back on both responses so the
 * caller can match async writes against the role they were editing
 * without holding the id separately. `abilities` is the authoritative
 * stored set after the write.
 */
export const getRoleAbilitiesResponseSchema = z.object({
  roleId: z.string(),
  abilities: z.array(z.string()),
})
export type GetRoleAbilitiesResponse = z.infer<typeof getRoleAbilitiesResponseSchema>

export const setRoleAbilitiesResponseSchema = z.object({
  roleId: z.string(),
  abilities: z.array(z.string()),
})
export type SetRoleAbilitiesResponse = z.infer<typeof setRoleAbilitiesResponseSchema>
