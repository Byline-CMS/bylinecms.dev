/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { getUploadFields, hasUploadField, isUploadField } from './storage-utils.js'
import type { Field } from '../@types/field-types.js'

const upload = { mimeTypes: ['application/pdf'], maxFileSize: 1024 }

const coverField: Field = { name: 'cover', label: 'Cover', type: 'image', upload }

const nestedFileField: Field = { name: 'publicationFile', label: 'File', type: 'file', upload }

describe('isUploadField', () => {
  it('is true for image/file fields with an upload block', () => {
    expect(isUploadField(coverField)).toBe(true)
    expect(isUploadField(nestedFileField)).toBe(true)
  })

  it('is false for image/file fields without an upload block', () => {
    expect(isUploadField({ name: 'pic', label: 'Pic', type: 'image' })).toBe(false)
    expect(isUploadField({ name: 'doc', label: 'Doc', type: 'file' })).toBe(false)
  })

  it('is false for non-media fields', () => {
    expect(isUploadField({ name: 'title', label: 'Title', type: 'text' })).toBe(false)
  })
})

describe('getUploadFields', () => {
  it('returns top-level upload fields', () => {
    const fields: Field[] = [{ name: 'title', label: 'Title', type: 'text' }, coverField]
    expect(getUploadFields({ fields }).map((f) => f.name)).toEqual(['cover'])
  })

  it('recurses into group / array / blocks structure fields', () => {
    const fields: Field[] = [
      coverField,
      {
        name: 'files',
        label: 'Files',
        type: 'array',
        fields: [
          {
            name: 'filesGroup',
            type: 'group',
            fields: [nestedFileField, { name: 'label', label: 'Label', type: 'text' }],
          },
        ],
      },
      {
        name: 'content',
        label: 'Content',
        type: 'blocks',
        blocks: [
          {
            blockType: 'photo',
            label: 'Photo',
            fields: [{ name: 'photo', label: 'Photo', type: 'image', upload }],
          },
        ],
      },
    ]

    expect(getUploadFields({ fields }).map((f) => f.name)).toEqual([
      'cover',
      'publicationFile',
      'photo',
    ])
  })

  it('skips nested image/file fields without an upload block', () => {
    const fields: Field[] = [
      {
        name: 'gallery',
        label: 'Gallery',
        type: 'group',
        fields: [{ name: 'pic', label: 'Pic', type: 'image' }],
      },
    ]
    expect(getUploadFields({ fields })).toEqual([])
  })
})

describe('hasUploadField', () => {
  it('detects upload fields at any nesting depth', () => {
    const fields: Field[] = [
      {
        name: 'files',
        label: 'Files',
        type: 'array',
        fields: [{ name: 'filesGroup', type: 'group', fields: [nestedFileField] }],
      },
    ]
    expect(hasUploadField({ fields })).toBe(true)
    expect(hasUploadField({ fields: [{ name: 'title', label: 'Title', type: 'text' }] })).toBe(
      false
    )
  })
})
