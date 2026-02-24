/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field } from '@byline/core'
import { resolveFieldDefaultValue } from '@byline/core'

export const placeholderStoredFileValue = {
  file_id: crypto.randomUUID(),
  filename: 'placeholder',
  original_filename: 'placeholder',
  mime_type: 'application/octet-stream',
  file_size: 0,
  storage_provider: 'placeholder',
  storage_path: 'pending',
  storage_url: null,
  file_hash: null,
  image_width: null,
  image_height: null,
  image_format: null,
  processing_status: 'pending',
  thumbnail_generated: false,
}

export const placeholderForField = (f: Field): any => {
  switch (f.type) {
    case 'text':
    case 'textArea':
      return ''
    case 'checkbox':
      return false
    case 'integer':
      return 0
    case 'richText':
    case 'datetime':
      return undefined
    case 'select':
      return ''
    case 'file':
    case 'image':
      return placeholderStoredFileValue
    default:
      return null
  }
}

export const defaultScalarForField = async (
  f: Field,
  getFieldValues: () => Record<string, any>
): Promise<any> => {
  const schemaDefault = await resolveFieldDefaultValue(f, {
    data: getFieldValues(),
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  })

  if (schemaDefault !== undefined) {
    return schemaDefault
  }

  return placeholderForField(f)
}
