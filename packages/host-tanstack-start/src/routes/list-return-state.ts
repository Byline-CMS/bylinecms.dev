/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Return-to-list state for the collection editor (issue #17).
 *
 * The list route holds its complete view state in URL search params, so
 * "come back to page 7 of the filtered list" needs no storage: the list
 * encodes its current search into a single `from` param on the editor
 * link, the editor threads it through its own navigations, and
 * close/delete decode it back into list search params. Malformed or
 * absent state degrades to the bare list — never an error.
 *
 * The list route's search schema lives here (rather than in the route
 * factory) so the helpers and the factory share one definition without
 * a circular import.
 */

import { z } from 'zod'

export const collectionListSearchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  query: z.string().optional(),
  locale: z.string().optional(),
  status: z.string().optional(),
  action: z.enum(['created']).optional(),
})

export type CollectionListSearch = z.infer<typeof collectionListSearchSchema>

/**
 * The keys a return target carries. `action` is transient (post-create
 * toast trigger) and must never round-trip through a return target.
 */
const RETURN_KEYS = ['page', 'page_size', 'order', 'desc', 'query', 'locale', 'status'] as const

/** `undefined` when there is nothing worth carrying (bare list). */
export function encodeListReturnState(search: Record<string, unknown>): string | undefined {
  const params = new URLSearchParams()
  for (const key of RETURN_KEYS) {
    const value = search[key]
    if (value != null && value !== '') params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded.length > 0 ? encoded : undefined
}

/**
 * Parse a `from` param back into list search params. Runs the decoded
 * pairs through the list search schema; anything malformed returns
 * `undefined` (→ bare list). `desc` needs explicit normalisation
 * because `z.coerce.boolean()` would coerce the string `'false'` to
 * `true`.
 */
export function decodeListReturnState(
  from: string | undefined
): Record<string, unknown> | undefined {
  if (from == null || from.length === 0) return undefined
  const raw: Record<string, unknown> = Object.fromEntries(new URLSearchParams(from))
  delete raw.action
  if (typeof raw.desc === 'string') raw.desc = raw.desc === 'true'
  const parsed = collectionListSearchSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}
