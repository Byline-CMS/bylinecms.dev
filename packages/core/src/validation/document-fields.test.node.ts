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
      issues: [{ field: 'title', message: 'Required', kind: 'invalid' }],
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

  describe('issue classification', () => {
    it('marks absent declared values required and everything else invalid', () => {
      const issues = validateDocumentFields(fields, {
        title: 'ab',
        details: { name: 'ok' },
        items: 'not-an-array',
        content: [{ _id: 'b1', _type: 'unknown' }],
      })
      const byField = Object.fromEntries(issues.map((issue) => [issue.field, issue.kind]))
      expect(byField).toEqual({
        title: 'invalid',
        items: 'invalid',
        'content[id=b1]': 'invalid',
      })
      expect(validateDocumentFields(fields, {}).every((issue) => issue.kind === 'required')).toBe(
        true
      )
    })

    it('classifies a custom validator as invalid even when it describes a requirement', () => {
      const conditional: Field[] = [
        { name: 'kind', type: 'text' },
        {
          name: 'doi',
          type: 'text',
          optional: true,
          validate: (value, data) =>
            data.kind === 'journal' && !value ? 'DOI is required for journal articles' : undefined,
        },
      ]
      const issues = validateDocumentFields(conditional, { kind: 'journal' })
      expect(issues).toEqual([
        { field: 'doi', message: 'DOI is required for journal articles', kind: 'invalid' },
      ])
      expect(() => assertDocumentFields(conditional, { kind: 'journal' })).toThrow(
        'Some document fields are invalid'
      )
      // The condition itself is never consulted by the lifecycle.
      expect(validateDocumentFields(conditional, { kind: 'blog' })).toEqual([])
    })
  })

  describe('schema-author callbacks that throw', () => {
    // A validator written against today's shape meets a historical version
    // that lacks the field. An exception must not escape the walk.
    const throwingValidate: Field[] = [
      { name: 'title', type: 'text' },
      {
        name: 'slug',
        type: 'text',
        optional: true,
        validate: (value: any) => (value.trim() === '' ? 'empty' : undefined),
      },
    ]

    it('records a failed validator as an issue instead of throwing', () => {
      const issues = validateDocumentFields(throwingValidate, { title: 'ok' })
      expect(issues).toEqual([
        { field: 'slug', message: 'slug: could not be validated', kind: 'invalid' },
      ])
    })

    it('isolates a throwing custom validation rule', () => {
      const issues = validateDocumentFields(
        [
          { name: 'title', type: 'text' },
          {
            name: 'code',
            type: 'text',
            validation: { rules: [{ type: 'custom', value: (v: any) => v.deep.thing === 1 }] },
          },
        ],
        { title: 't', code: 'x' }
      )
      expect(issues).toEqual([
        { field: 'code', message: 'code: could not be validated', kind: 'invalid' },
      ])
    })

    it('isolates a failure while the schema itself is being built', () => {
      // A malformed `pattern` throws from `new RegExp` before any parse.
      const issues = validateDocumentFields(
        [{ name: 'p', type: 'text', validation: { rules: [{ type: 'pattern', value: '([' }] } }],
        { p: 'x' }
      )
      expect(issues).toEqual([
        { field: 'p', message: 'p: could not be validated', kind: 'invalid' },
      ])
    })

    it('keeps collecting issues after one callback fails', () => {
      const issues = validateDocumentFields(throwingValidate, {})
      expect(issues.map((issue) => issue.field)).toEqual(['title', 'slug'])
    })

    it('still refuses an ordinary save, with a readable message', () => {
      expect(() => assertDocumentFields(throwingValidate, { title: 'ok' })).toThrow(
        'Some document fields are invalid'
      )
    })

    it('treats a throwing condition as visible and surfaces it', () => {
      const throwingCondition: Field[] = [
        { name: 'a', type: 'text', condition: (data: any) => data.missing.deep === 1 },
      ]
      const issues = validateDocumentFields(throwingCondition, {}, { respectConditions: true })
      // Fail closed: the field is still validated, and the misconfiguration
      // is reported rather than silently hiding the field.
      expect(issues.map((issue) => issue.message)).toEqual([
        'a: could not be validated',
        'a is required',
      ])
    })

    it('never copies an exception message into an editor-facing issue', () => {
      // Issue messages cross the server boundary. An unexpected exception can
      // carry internal diagnostics, so the message is fixed and detail-free.
      const secret = 'ECONNREFUSED postgres://user:hunter2@10.0.0.4:5432/prod'
      const seen: unknown[] = []
      const issues = validateDocumentFields(
        [
          {
            name: 'x',
            type: 'text',
            validate: () => {
              throw new Error(secret)
            },
          },
        ],
        { x: 'v' },
        { onCallbackError: ({ error, site }) => seen.push([site, error]) }
      )
      expect(issues).toEqual([
        { field: 'x', message: 'x: could not be validated', kind: 'invalid' },
      ])
      expect(JSON.stringify(issues)).not.toContain('hunter2')
      // The real error is still available to server-side diagnostics.
      expect(seen).toEqual([['validate', expect.objectContaining({ message: secret })]])
    })

    it('is not aborted by a diagnostic sink that throws', () => {
      // The sink reaches a logger, which can fail too. Diagnostics must never
      // abort the validation they describe.
      const issues = validateDocumentFields(
        [
          {
            name: 'x',
            type: 'text',
            validate: () => {
              throw new Error('inner')
            },
          },
        ],
        { x: 'v' },
        {
          onCallbackError: () => {
            throw new Error('logger is down')
          },
        }
      )
      expect(issues).toEqual([
        { field: 'x', message: 'x: could not be validated', kind: 'invalid' },
      ])
    })

    it('keeps a message a validator deliberately returns', () => {
      const issues = validateDocumentFields(
        [
          {
            name: 'doi',
            type: 'text',
            optional: true,
            validate: () => 'DOI must be a 10.x prefix',
          },
        ],
        { doi: 'x' }
      )
      expect(issues[0]?.message).toBe('DOI must be a 10.x prefix')
    })
  })

  describe('the serialized decoder', () => {
    it('decodes an unknown or absent kind as invalid, never as waivable', () => {
      const details = getDocumentFieldValidationDetails({
        code: ERR_VALIDATION({ message: 'x' }).code,
        details: {
          reason: 'invalid_document_fields',
          issues: [
            { field: 'a', message: 'A' },
            { field: 'b', message: 'B', kind: 'bogus' },
            { field: 'c', message: 'C', kind: 'required' },
          ],
        },
      })
      expect(details?.issues.map((issue) => issue.kind)).toEqual(['invalid', 'invalid', 'required'])
    })
  })
})
