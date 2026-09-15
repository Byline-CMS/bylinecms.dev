/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_VALIDATION, ErrorCodes } from '../lib/errors.js'
import { fieldToZodSchema } from '../schemas/zod/builder.js'
import type { Field, FieldSet } from '../@types/field-types.js'

export interface DocumentFieldIssue {
  field: string
  message: string
  /**
   * `required` marks a value that is absent but declared non-optional — the
   * shape schema tightening produces. Every other failure, including a custom
   * `validate` callback's message, is `invalid`: it describes a value that is
   * present and wrong, or a container that cannot be stored. Nothing branches
   * on this to decide whether a write proceeds; it exists so callers can tell
   * an editor what is missing separately from what is wrong.
   */
  kind: 'required' | 'invalid'
}

export interface DocumentFieldValidationDetails {
  reason: 'invalid_document_fields'
  issues: DocumentFieldIssue[]
}

const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)

/** Validate schema data without transforming or stripping persistence values. */
export function validateDocumentFields(
  fields: FieldSet,
  data: Record<string, any>,
  options: {
    locale?: string
    /** Browser-only presentation precheck; the lifecycle never exempts hidden fields. */
    respectConditions?: boolean
    /** Pending uploads are validated after transport by the lifecycle. */
    skip?: (path: string) => boolean
  } = {}
): DocumentFieldIssue[] {
  const issues: DocumentFieldIssue[] = []
  const add = (field: string, message: string, kind: DocumentFieldIssue['kind'] = 'invalid') =>
    issues.push({ field, message, kind })
  const visit = (fieldSet: FieldSet, values: Record<string, any>, prefix = '') => {
    for (const field of fieldSet) {
      const path = prefix ? `${prefix}.${field.name}` : field.name
      if (options.skip?.(path)) continue
      if (options.respectConditions && field.condition && !field.condition(data, values)) continue
      const value = values[field.name]
      if (field.localized && options.locale === 'all' && record(value)) {
        const locales = Object.keys(value)
        if (!locales.length && !field.optional)
          add(path, `${field.label ?? field.name} is required`, 'required')
        for (const locale of locales) validate(field, value[locale], `${path}.${locale}`)
      } else validate(field, value, path)
    }
  }
  const validate = (field: Field, value: any, path: string) => {
    const label = field.label ?? field.name
    if (field.validate) {
      const message = field.validate(value, data)
      if (message) add(path, message)
    }
    if (value == null || value === '') {
      if (!field.optional && field.type !== 'counter') add(path, `${label} is required`, 'required')
      // Empty values count as absent when checking requiredness.
      return
    }
    if (field.type === 'group') {
      if (!record(value)) add(path, `${label} must be an object`)
      else visit(field.fields, value, path)
    } else if (field.type === 'array' || field.type === 'blocks') {
      if (!Array.isArray(value)) add(path, `${label} must be an array`)
      else {
        if (field.type === 'array') {
          if (field.validation?.minLength != null && value.length < field.validation.minLength)
            add(path, `${label} requires at least ${field.validation.minLength} items`)
          if (field.validation?.maxLength != null && value.length > field.validation.maxLength)
            add(path, `${label} allows at most ${field.validation.maxLength} items`)
        }
        value.forEach((item, index) => {
          const itemPath =
            record(item) && typeof item._id === 'string' && /^[\w-]+$/.test(item._id)
              ? `${path}[id=${item._id}]`
              : `${path}[${index}]`
          if (!record(item)) {
            add(itemPath, 'Item must be an object')
            return
          }
          if (field.type === 'array') visit(field.fields, item, itemPath)
          else {
            const block = field.blocks.find((candidate) => candidate.blockType === item._type)
            if (!block) add(itemPath, 'Unknown block type')
            else visit(block.fields, item, itemPath)
          }
        })
      }
    } else {
      const parsed = fieldToZodSchema(field).safeParse(value)
      if (!parsed.success)
        add(path, `${label}: ${parsed.error.issues[0]?.message ?? 'Invalid value'}`)
    }
  }
  if (!record(data))
    return [{ field: '', message: 'Document fields must be an object', kind: 'invalid' }]
  visit(fields, data)
  return issues
}

/**
 * Enforce the collection's declared field contract over prepared content.
 *
 * Every versioned write passes through this except a restore, which is exempt
 * structurally rather than by a parameter here — see `assertWritableContent`
 * in the lifecycle's `persistence.ts` for why, and for what that exemption
 * does and does not promise.
 */
export function assertDocumentFields(
  fields: FieldSet,
  data: Record<string, any>,
  locale?: string
): void {
  const issues = validateDocumentFields(fields, data, { locale })
  if (issues.length)
    throw ERR_VALIDATION({
      message: 'Some document fields are invalid.',
      details: {
        reason: 'invalid_document_fields',
        issues,
      } satisfies DocumentFieldValidationDetails,
    })
}

/** Accept live errors and serialized reports, discarding all non-contract data. */
export function getDocumentFieldValidationDetails(
  error: unknown
): DocumentFieldValidationDetails | null {
  try {
    if (!record(error) || error.code !== ErrorCodes.VALIDATION) return null
    const details = error.details
    if (
      !record(details) ||
      details.reason !== 'invalid_document_fields' ||
      !Array.isArray(details.issues) ||
      !details.issues.length
    )
      return null
    const issues: DocumentFieldIssue[] = []
    for (const issue of details.issues) {
      if (
        !record(issue) ||
        typeof issue.field !== 'string' ||
        typeof issue.message !== 'string' ||
        !issue.message.trim()
      )
        return null
      // An unrecognised or absent `kind` decodes as `invalid` — the blocking
      // reading. A waiver must never be inferred from a malformed payload.
      issues.push({
        field: issue.field,
        message: issue.message,
        kind: issue.kind === 'required' ? 'required' : 'invalid',
      })
    }
    return { reason: 'invalid_document_fields', issues }
  } catch {
    return null
  }
}
