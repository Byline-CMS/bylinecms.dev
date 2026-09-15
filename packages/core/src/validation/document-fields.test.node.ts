/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { ERR_VALIDATION } from '../lib/errors.js'
import {
  assertDocumentFields,
  getDocumentFieldValidationDetails,
  validateDocumentFields,
} from './document-fields.js'
import type { Field } from '../@types/field-types.js'

const fields: Field[] = [
  { name: 'title', type: 'text', validation: { minLength: 3 } },
  { name: 'details', type: 'group', fields: [{ name: 'name', type: 'text' }] },
  { name: 'items', type: 'array', fields: [{ name: 'name', type: 'text' }] },
  {
    name: 'content',
    type: 'blocks',
    blocks: [{ blockType: 'heading', fields: [{ name: 'text', type: 'text' }] }],
  },
]
const valid = { title: 'Hello', details: { name: 'OK' }, items: [], content: [] }

describe('document field validation', () => {
  it('validates root, group, array and block requirements with stable item paths', () => {
    const issues = validateDocumentFields(fields, {
      title: '',
      details: {},
      items: [{ _id: 'item-1' }],
      content: [{ _id: 'block-1', _type: 'heading' }],
    })
    expect(issues.map((i) => i.field)).toEqual([
      'title',
      'details.name',
      'items[id=item-1].name',
      'content[id=block-1].text',
    ])
  })
  it('accepts valid fields without stripping metadata or changing values', () => {
    expect(validateDocumentFields(fields, valid)).toEqual([])
    expect(valid).toEqual({ title: 'Hello', details: { name: 'OK' }, items: [], content: [] })
  })
  it('rejects malformed structures and unknown block types', () => {
    expect(
      validateDocumentFields(fields, {
        ...valid,
        details: 'wrong',
        items: [42],
        content: [{ _type: 'unknown' }],
      }).map((i) => i.field)
    ).toEqual(['details', 'items[0]', 'content[0]'])
  })
  it('enforces declared scalar constraints and relation cardinality', () => {
    const schema: Field[] = [
      { name: 'count', type: 'integer', validation: { min: 1, max: 5 } },
      { name: 'email', type: 'text', validation: { rules: [{ type: 'email', value: true }] } },
      {
        name: 'links',
        type: 'relation',
        targetCollection: 'pages',
        hasMany: true,
        minItems: 1,
        maxItems: 2,
      },
    ]
    expect(
      validateDocumentFields(schema, { count: 7, email: 'bad', links: [] }).map((i) => i.field)
    ).toEqual(['count', 'email', 'links'])
  })
  it('accepts JSON and object values and enforces text-area and code rules', () => {
    const schema: Field[] = [
      { name: 'json', type: 'json' },
      { name: 'object', type: 'object' },
      { name: 'area', type: 'textArea', validation: { pattern: '^ok' } },
      { name: 'code', type: 'code', validation: { rules: [{ type: 'min', value: 3 }] } },
    ]
    expect(
      validateDocumentFields(schema, {
        json: [true, null],
        object: { count: 1 },
        area: 'okay',
        code: 'abc',
      })
    ).toEqual([])
    expect(
      validateDocumentFields(schema, { json: new Date(), object: [], area: 'bad', code: 'x' }).map(
        (issue) => issue.field
      )
    ).toEqual(['json', 'object', 'area', 'code'])
  })
  it('allows omitted optional containers but validates present children', () => {
    const schema: Field[] = [
      { name: 'details', type: 'group', optional: true, fields: [{ name: 'title', type: 'text' }] },
    ]
    expect(validateDocumentFields(schema, {})).toEqual([])
    expect(validateDocumentFields(schema, { details: {} })[0]?.field).toBe('details.title')
  })
  it('validates locale-all values individually, without assuming an editor JSON shape', () => {
    const schema: Field[] = [{ name: 'title', type: 'text', localized: true }]
    expect(
      validateDocumentFields(schema, { title: { en: 'Hi', fr: '' } }, { locale: 'all' })[0]?.field
    ).toBe('title.fr')
    expect(validateDocumentFields(schema, { title: 'Hi' }, { locale: 'en' })).toEqual([])
  })
  it('only exempts condition-hidden fields in the browser precheck', () => {
    const schema: Field[] = [{ name: 'hidden', type: 'text', condition: () => false }]
    expect(validateDocumentFields(schema, {}, { respectConditions: true })).toEqual([])
    expect(validateDocumentFields(schema, {})).toHaveLength(1)
  })
  it('does not require a client-supplied counter', () => {
    expect(validateDocumentFields([{ name: 'id', type: 'counter', group: 'ids' }], {})).toEqual([])
  })
  it('decodes only field-validation details and strips private properties', () => {
    const error = ERR_VALIDATION({
      message: 'private',
      details: {
        reason: 'invalid_document_fields',
        sql: 'private',
        issues: [{ field: 'title', message: 'Required', value: 'private' }],
      },
    })
    expect(getDocumentFieldValidationDetails(error)).toEqual({
      reason: 'invalid_document_fields',
      issues: [{ field: 'title', message: 'Required' }],
    })
    expect(
      getDocumentFieldValidationDetails({
        code: error.code,
        details: { reason: 'missing_document_revision' },
      })
    ).toBeNull()
    expect(
      getDocumentFieldValidationDetails({
        code: error.code,
        details: { reason: 'invalid_document_fields', issues: [{ field: 'title' }] },
      })
    ).toBeNull()
    expect(
      getDocumentFieldValidationDetails({
        get code() {
          throw new Error('getter')
        },
      })
    ).toBeNull()
  })
  it('throws a structured validation error', () => {
    expect(() => assertDocumentFields(fields, {})).toThrow('Some document fields are invalid')
  })
})
