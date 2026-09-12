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
 * The `value` payload is validated against a schema chosen by the scope
 * key, so each registered family enforces its own shape: a list scope
 * takes only list keys, the analytics dashboard takes only a period. A
 * scope matching no registered family is rejected on write, so a
 * scripted caller cannot mint junk rows even under its own actor id.
 * Reads are deliberately unconstrained — `getPreference` on an unknown
 * scope simply finds nothing.
 *
 * Registering a third family is two lines: a value schema, and an entry
 * in `PREFERENCE_VALUE_SCHEMAS`.
 */

import { ANALYTICS_DASHBOARD_PERIODS } from '@byline/analytics/config'
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

/**
 * Sticky analytics-dashboard keys. The period list is sourced from
 * `@byline/analytics/config` rather than restated, so the stored value
 * can only ever be one the dashboard actually offers — adding a sixth
 * period there admits it here with no edit.
 *
 * Note the stored `period` is the *parsed* value (`30`, `'ytd'`), not
 * the `?period=30` URL string the route validates on the way in.
 */
export const analyticsViewPreferenceValueSchema = z
  .object({
    period: z.union([
      z.literal(ANALYTICS_DASHBOARD_PERIODS[0]),
      z.literal(ANALYTICS_DASHBOARD_PERIODS[1]),
      z.literal(ANALYTICS_DASHBOARD_PERIODS[2]),
      z.literal(ANALYTICS_DASHBOARD_PERIODS[3]),
      z.literal(ANALYTICS_DASHBOARD_PERIODS[4]),
    ]),
  })
  .strict()

/**
 * The registered scope families, each a matcher over the scope key. A
 * list scope carries the collection path as its middle segment, so it
 * matches by shape; the analytics dashboard is a singleton and matches
 * literally.
 */
const PREFERENCE_VALUE_SCHEMAS: ReadonlyArray<{
  matches: (scope: string) => boolean
  schema: z.ZodType
}> = [
  {
    matches: (scope) => {
      const segments = scope.split('.')
      return segments.length === 3 && segments[0] === 'collections' && segments[2] === 'list'
    },
    schema: listViewPreferenceValueSchema,
  },
  {
    matches: (scope) => scope === 'analytics.dashboard',
    schema: analyticsViewPreferenceValueSchema,
  },
]

/**
 * The value schema a scope selects, or `undefined` when the scope
 * belongs to no registered family. Exported so callers (and tests) can
 * ask the same question the write path asks.
 */
export function resolvePreferenceValueSchema(scope: string): z.ZodType | undefined {
  return PREFERENCE_VALUE_SCHEMAS.find((family) => family.matches(scope))?.schema
}

export const getPreferenceRequestSchema = z.object({
  scope: preferenceScopeSchema,
})
export type GetPreferenceRequest = z.infer<typeof getPreferenceRequestSchema>

export const setPreferenceRequestSchema = z
  .object({
    scope: preferenceScopeSchema,
    value: z.record(z.string(), z.unknown()),
  })
  .superRefine((input, ctx) => {
    const schema = resolvePreferenceValueSchema(input.scope)
    if (schema == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'scope does not belong to a registered preference family',
      })
      return
    }
    const result = schema.safeParse(input.value)
    if (result.success) return
    for (const issue of result.error.issues) {
      ctx.addIssue({ ...issue, path: ['value', ...issue.path] })
    }
  })
export type SetPreferenceRequest = z.infer<typeof setPreferenceRequestSchema>

/** `value` is `null` when the user has no stored preference for the scope. */
export const preferenceResponseSchema = z.object({
  scope: z.string(),
  value: z.record(z.string(), z.unknown()).nullable(),
})
export type PreferenceResponse = z.infer<typeof preferenceResponseSchema>
