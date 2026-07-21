/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Zod schemas for the admin-preferences commands.
 *
 * Self-service, like admin-account: none of the request schemas accept a
 * user id — the command resolves the target from `actor.id`.
 *
 * The `value` payload is validated against the list-view shape because
 * that is the only registered scope family today
 * (`collections.<path>.list`). When a second scope family arrives, this
 * becomes a scope-keyed selection of value schemas.
 */

import { z } from 'zod'

/** Dot-separated segment key, e.g. `collections.docs.list`. */
export const preferenceScopeSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i, {
    message: 'scope must be dot-separated segments of [a-z0-9_-]',
  })

/**
 * Sticky list-view keys. All optional — clients send only the keys the
 * interaction changed, and the repository merges per-key — but an empty
 * object is rejected (nothing to write).
 */
export const listViewPreferenceValueSchema = z
  .object({
    page_size: z.number().int().min(1).max(100).optional(),
    order: z.string().min(1).max(255).optional(),
    desc: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'value cannot be empty' })

export const getPreferenceRequestSchema = z.object({
  scope: preferenceScopeSchema,
})
export type GetPreferenceRequest = z.infer<typeof getPreferenceRequestSchema>

export const setPreferenceRequestSchema = z.object({
  scope: preferenceScopeSchema,
  value: listViewPreferenceValueSchema,
})
export type SetPreferenceRequest = z.infer<typeof setPreferenceRequestSchema>

/** `value` is `null` when the user has no stored preference for the scope. */
export const preferenceResponseSchema = z.object({
  scope: z.string(),
  value: z.record(z.string(), z.unknown()).nullable(),
})
export type PreferenceResponse = z.infer<typeof preferenceResponseSchema>
