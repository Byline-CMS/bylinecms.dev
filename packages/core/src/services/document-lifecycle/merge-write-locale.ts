/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldSet } from '../../@types/index.js'

/** Preserve other locales by item identity after unavailable blocks were compacted.
 * Incoming structure is authoritative; never carry old positional store rows forward.
 */
export function mergeWriteLocale(
  fields: FieldSet,
  previous: Record<string, any>,
  incoming: Record<string, any>,
  locale: string
): Record<string, any> {
  const result: Record<string, any> = {}
  for (const field of fields) {
    const value = incoming[field.name]
    const old = previous?.[field.name]
    if (field.type === 'group') {
      if (value != null)
        result[field.name] = mergeWriteLocale(field.fields, old ?? {}, value, locale)
    } else if (field.type === 'array' || field.type === 'blocks') {
      if (!Array.isArray(value)) continue
      result[field.name] = value.map((item, index) => {
        // Hand-built payloads may omit identity metadata. Match their compacted
        // position, as ordinary locale writes do; an explicit ID stays authoritative.
        const prior = Array.isArray(old)
          ? item._id != null
            ? old.find((candidate) => candidate._id === item._id)
            : old[index]
          : undefined
        const childFields =
          field.type === 'array'
            ? field.fields
            : field.blocks.find((block) => block.blockType === item._type)?.fields
        return {
          ...(item._id != null ? { _id: item._id } : {}),
          ...(field.type === 'blocks' ? { _type: item._type } : {}),
          ...mergeWriteLocale(childFields ?? [], prior ?? {}, item, locale),
        }
      })
    } else if (field.localized) {
      const localized = { ...old }
      delete localized[locale]
      if (value !== undefined) localized[locale] = value
      if (Object.keys(localized).length > 0) result[field.name] = localized
    } else if (value !== undefined) result[field.name] = value
  }
  return result
}
