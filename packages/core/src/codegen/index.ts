/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'

import type { Block, CollectionDefinition, Field, FieldSet } from '../@types/index.js'

const FORMAT_VERSION = 2
const HASH_DOMAIN = '@byline/core/codegen:collection-types:v2\n'
const IMPORT_ORDER = ['JsonObject', 'JsonValue', 'RelatedDocumentValue', 'StoredFileValue'] as const

type CanonicalImport = (typeof IMPORT_ORDER)[number]
type LocaleMode = 'single' | 'all'

interface BlockContract {
  alias: string
  blockType: string
  fields: FieldSet
  key: string
}

interface CollectionContract {
  alias: string
  definition: CollectionDefinition
}

interface Analysis {
  blockKeyByDefinition: WeakMap<object, string>
  blocks: Map<string, Omit<BlockContract, 'alias'>>
  collections: CollectionDefinition[]
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function quote(value: string): string {
  return `'${value.replace(/[\\'\b\f\n\r\t\v\0\u2028\u2029]/g, (character) => {
    switch (character) {
      case '\\':
        return '\\\\'
      case "'":
        return "\\'"
      case '\b':
        return '\\b'
      case '\f':
        return '\\f'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\t':
        return '\\t'
      case '\v':
        return '\\v'
      case '\0':
        return '\\0'
      case '\u2028':
        return '\\u2028'
      case '\u2029':
        return '\\u2029'
      default:
        return character
    }
  })}'`
}

function propertyKey(value: string): string {
  return /^[$_\p{ID_Start}](?:[$_\p{ID_Continue}]|\u200C|\u200D)*$/u.test(value)
    ? value
    : quote(value)
}

function normalizeIdentifier(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  const words = ascii.match(/[A-Za-z0-9]+/g) ?? []
  const normalized = words
    .map((word) => {
      const lower = word.toLowerCase()
      return `${lower[0]?.toUpperCase() ?? ''}${lower.slice(1)}`
    })
    .join('')
  if (normalized.length === 0) return 'Unnamed'
  return /^[0-9]/.test(normalized) ? `N${normalized}` : normalized
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function assignNames<T>(
  values: readonly T[],
  baseName: (value: T) => string,
  identity: (value: T) => string
): Map<T, string> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const base = baseName(value)
    const group = groups.get(base)
    if (group) group.push(value)
    else groups.set(base, [value])
  }

  const result = new Map<T, string>()
  for (const [base, group] of groups) {
    if (group.length === 1) {
      const only = group[0]
      if (only !== undefined) result.set(only, base)
      continue
    }

    const ordered = [...group].sort((a, b) => compareStrings(identity(a), identity(b)))
    const hashes = ordered.map((value) => sha256(identity(value)))
    let suffixLength = 8
    while (
      suffixLength < 64 &&
      new Set(hashes.map((hash) => hash.slice(0, suffixLength))).size !== hashes.length
    ) {
      suffixLength += 1
    }
    for (const [index, value] of ordered.entries()) {
      const hash = hashes[index]
      if (hash === undefined) continue
      const duplicateHashIndex = hashes.indexOf(hash)
      const suffix =
        duplicateHashIndex === index ? hash.slice(0, suffixLength) : `${hash}_${index + 1}`
      result.set(value, `${base}_${suffix}`)
    }
  }
  return result
}

function assertObject(value: unknown, location: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new Error(`emitCollectionTypes: expected an object at ${location}`)
  }
}

function analyze(collections: readonly CollectionDefinition[]): Analysis {
  const sortedCollections = [...collections].sort((a, b) => compareStrings(a.path, b.path))
  const seenPaths = new Set<string>()
  const active = new Set<object>()
  const blocks = new Map<string, Omit<BlockContract, 'alias'>>()
  const blockKeyByDefinition = new WeakMap<object, string>()

  function describeFieldSet(fields: FieldSet, location: string): string {
    if (!Array.isArray(fields)) {
      throw new Error(`emitCollectionTypes: expected fields array at ${location}`)
    }
    if (active.has(fields)) throw new Error(`emitCollectionTypes: cycle detected at ${location}`)
    active.add(fields)

    const seenNames = new Set<string>()
    const descriptions: string[] = []
    for (const [index, fieldValue] of fields.entries()) {
      const fieldLocation = `${location}[${index}]`
      assertObject(fieldValue, fieldLocation)
      const field = fieldValue as unknown as Field
      if (typeof field.name !== 'string') {
        throw new Error(`emitCollectionTypes: expected field name at ${fieldLocation}`)
      }
      if (seenNames.has(field.name)) {
        throw new Error(
          `emitCollectionTypes: duplicate sibling field ${quote(field.name)} at ${location}`
        )
      }
      seenNames.add(field.name)
      descriptions.push(describeField(field, fieldLocation))
    }

    active.delete(fields)
    return JSON.stringify(descriptions)
  }

  function describeBlock(blockValue: Block, location: string): string {
    assertObject(blockValue, location)
    const block = blockValue as Block
    if (active.has(block)) throw new Error(`emitCollectionTypes: cycle detected at ${location}`)
    active.add(block)
    if (typeof block.blockType !== 'string') {
      throw new Error(`emitCollectionTypes: expected blockType at ${location}`)
    }
    const fieldsSignature = describeFieldSet(block.fields, `${location}.fields`)
    const key = JSON.stringify([block.blockType, fieldsSignature])
    blockKeyByDefinition.set(block, key)
    if (!blocks.has(key)) {
      blocks.set(key, { blockType: block.blockType, fields: block.fields, key })
    }
    active.delete(block)
    return key
  }

  function describeField(field: Field, location: string): string {
    if (active.has(field)) throw new Error(`emitCollectionTypes: cycle detected at ${location}`)
    active.add(field)
    const modifiers = [field.optional === true, field.localized === true]
    let specific: unknown

    switch (field.type) {
      case 'array':
      case 'group':
        specific = describeFieldSet(field.fields, `${location}.fields`)
        break
      case 'blocks': {
        if (!Array.isArray(field.blocks)) {
          throw new Error(`emitCollectionTypes: expected blocks array at ${location}.blocks`)
        }
        if (active.has(field.blocks)) {
          throw new Error(`emitCollectionTypes: cycle detected at ${location}.blocks`)
        }
        active.add(field.blocks)
        const seenBlockTypes = new Set<string>()
        specific = field.blocks.map((block, index) => {
          if (seenBlockTypes.has(block.blockType)) {
            throw new Error(
              `emitCollectionTypes: duplicate local block type ${quote(block.blockType)} at ${location}`
            )
          }
          seenBlockTypes.add(block.blockType)
          return describeBlock(block, `${location}.blocks[${index}]`)
        })
        active.delete(field.blocks)
        break
      }
      case 'select':
        specific = uniqueValues(field.options.map((option) => option.value))
        break
      case 'relation':
        specific = field.hasMany === true
        break
      case 'boolean':
      case 'checkbox':
      case 'code':
      case 'counter':
      case 'date':
      case 'datetime':
      case 'decimal':
      case 'file':
      case 'float':
      case 'image':
      case 'integer':
      case 'json':
      case 'object':
      case 'richText':
      case 'text':
      case 'textArea':
      case 'time':
        specific = null
        break
      default: {
        const exhaustive: never = field
        throw new Error(
          `emitCollectionTypes: unsupported runtime field type ${quote(
            String((exhaustive as unknown as { type?: unknown }).type)
          )} at ${location}`
        )
      }
    }

    active.delete(field)
    return JSON.stringify([field.name, field.type, ...modifiers, specific])
  }

  for (const collection of sortedCollections) {
    assertObject(collection, 'collections[]')
    if (typeof collection.path !== 'string') {
      throw new Error('emitCollectionTypes: expected collection path')
    }
    if (seenPaths.has(collection.path)) {
      throw new Error(`emitCollectionTypes: duplicate collection path ${quote(collection.path)}`)
    }
    seenPaths.add(collection.path)
    describeFieldSet(collection.fields, `collection ${quote(collection.path)}.fields`)
  }

  return { blockKeyByDefinition, blocks, collections: sortedCollections }
}

function indentLines(lines: readonly string[], spaces: number): string[] {
  const indentation = ' '.repeat(spaces)
  return lines.map((line) => `${indentation}${line}`)
}

function objectType(
  properties: readonly { key: string; optional?: boolean; value: string[] }[]
): string[] {
  if (properties.length === 0) return ['{}']
  const lines = ['{']
  for (const property of properties) {
    const first = property.value[0] ?? 'never'
    const suffix = property.optional ? ' | undefined' : ''
    if (property.value.length === 1) {
      lines.push(`  ${propertyKey(property.key)}${property.optional ? '?' : ''}: ${first}${suffix}`)
    } else {
      lines.push(`  ${propertyKey(property.key)}${property.optional ? '?' : ''}: ${first}`)
      lines.push(...indentLines(property.value.slice(1), 2))
      if (suffix) lines[lines.length - 1] = `${lines[lines.length - 1]}${suffix}`
    }
  }
  lines.push('}')
  return lines
}

function wrapGeneric(name: string, value: string[]): string[] {
  if (value.length === 1) return [`${name}<${value[0]}>`]
  return [`${name}<`, ...indentLines(value, 2), '>']
}

function wrapLocaleMap(value: string[]): string[] {
  if (value.length === 1) return [`{ [locale: string]: ${value[0]} }`]
  return ['{', `  [locale: string]: ${value[0]}`, ...indentLines(value.slice(1), 2), '}']
}

function emitBody(analysis: Analysis): string {
  const imports = new Set<CanonicalImport>()
  const rawBlocks = [...analysis.blocks.values()]
  const blockNames = assignNames(
    rawBlocks,
    (block) => {
      const stem = normalizeIdentifier(block.blockType)
      return stem.endsWith('Block') ? `${stem}Data` : `${stem}BlockData`
    },
    (block) => block.key
  )
  const blocks: BlockContract[] = rawBlocks
    .map((block) => ({ ...block, alias: blockNames.get(block) ?? 'UnnamedBlock' }))
    .sort((a, b) => compareStrings(a.alias, b.alias))

  const collectionNames = assignNames(
    analysis.collections,
    (collection) => `${normalizeIdentifier(collection.path)}Fields`,
    (collection) => collection.path
  )
  const collectionContracts: CollectionContract[] = analysis.collections.map((definition) => ({
    alias: collectionNames.get(definition) ?? 'UnnamedFields',
    definition,
  }))
  const blockAliasByKey = new Map(blocks.map((block) => [block.key, block.alias]))

  function fieldSetType(fields: FieldSet, mode: LocaleMode): string[] {
    return objectType(
      fields.map((field) => ({
        key: field.name,
        optional: field.optional === true,
        value: fieldType(field, mode),
      }))
    )
  }

  function fieldType(field: Field, mode: LocaleMode): string[] {
    let value: string[]
    switch (field.type) {
      case 'array':
        value = wrapGeneric(
          'Array',
          objectType([
            { key: '_id', value: ['string'] },
            ...field.fields.map((child) => ({
              key: child.name,
              optional: child.optional === true,
              value: fieldType(child, mode),
            })),
          ])
        )
        break
      case 'blocks': {
        const aliases = field.blocks.map((block) => {
          const key = analysis.blockKeyByDefinition.get(block)
          const alias = key === undefined ? undefined : blockAliasByKey.get(key)
          if (alias === undefined) {
            throw new Error(`emitCollectionTypes: missing analyzed block ${quote(block.blockType)}`)
          }
          return mode === 'all' ? `${alias}AllLocales` : alias
        })
        value = [`Array<${aliases.length === 0 ? 'never' : aliases.join(' | ')}>`]
        break
      }
      case 'group':
        value = fieldSetType(field.fields, mode)
        break
      case 'select':
        value = [
          field.options.length === 0
            ? 'never'
            : uniqueValues(field.options.map((option) => option.value))
                .map(quote)
                .join(' | '),
        ]
        break
      case 'relation':
        imports.add('RelatedDocumentValue')
        value = [field.hasMany === true ? 'RelatedDocumentValue[]' : 'RelatedDocumentValue']
        break
      case 'boolean':
      case 'checkbox':
        value = ['boolean']
        break
      case 'date':
      case 'datetime':
        value = ['Date']
        break
      case 'code':
      case 'decimal':
      case 'text':
      case 'textArea':
      case 'time':
        value = ['string']
        break
      case 'counter':
      case 'float':
      case 'integer':
        value = ['number']
        break
      case 'json':
      case 'richText':
        imports.add('JsonValue')
        value = ['JsonValue']
        break
      case 'object':
        imports.add('JsonObject')
        value = ['JsonObject']
        break
      case 'file':
      case 'image':
        imports.add('StoredFileValue')
        value = ['StoredFileValue']
        break
      default: {
        const exhaustive: never = field
        throw new Error(`emitCollectionTypes: unsupported runtime field type ${String(exhaustive)}`)
      }
    }

    return mode === 'all' && field.localized === true ? wrapLocaleMap(value) : value
  }

  const declarations: string[] = []
  for (const block of blocks) {
    const baseProperties = [
      { key: '_id', value: ['string'] },
      { key: '_type', value: [quote(block.blockType)] },
    ]
    declarations.push(
      `export type ${block.alias} = ${objectType([
        ...baseProperties,
        ...block.fields.map((field) => ({
          key: field.name,
          optional: field.optional === true,
          value: fieldType(field, 'single'),
        })),
      ]).join('\n')}`,
      '',
      `export type ${block.alias}AllLocales = ${objectType([
        ...baseProperties,
        ...block.fields.map((field) => ({
          key: field.name,
          optional: field.optional === true,
          value: fieldType(field, 'all'),
        })),
      ]).join('\n')}`,
      ''
    )
  }

  for (const collection of [...collectionContracts].sort((a, b) =>
    compareStrings(a.alias, b.alias)
  )) {
    declarations.push(
      `export type ${collection.alias} = ${fieldSetType(collection.definition.fields, 'single').join('\n')}`,
      '',
      `export type ${collection.alias}AllLocales = ${fieldSetType(
        collection.definition.fields,
        'all'
      ).join('\n')}`,
      ''
    )
  }

  declarations.push('export type CollectionFieldsByPath = {')
  for (const collection of collectionContracts) {
    declarations.push(`  ${propertyKey(collection.definition.path)}: ${collection.alias}`)
  }
  declarations.push('}', '', 'export type CollectionFieldsAllLocalesByPath = {')
  for (const collection of collectionContracts) {
    declarations.push(`  ${propertyKey(collection.definition.path)}: ${collection.alias}AllLocales`)
  }
  declarations.push('}', '', 'export type CollectionPath = keyof CollectionFieldsByPath')

  const usedImports = IMPORT_ORDER.filter((name) => imports.has(name))
  const importLines =
    usedImports.length === 0
      ? []
      : ['import type {', ...usedImports.map((name) => `  ${name},`), "} from '@byline/core'", '']

  // Every type declaration lives inside the `@byline/generated-types`
  // declaration-merge block, so the published stub package is the one
  // canonical import path for app collection types
  // (`import type { NewsFields } from '@byline/generated-types'`). The
  // file's top-level `@byline/core` imports remain visible inside the
  // block (module augmentation is lexically scoped).
  const declarationLines = declarations
    .join('\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.length === 0 ? line : `  ${line}`))

  // Register the app's collection registry with @byline/client (a second
  // declaration merge). Every bare `BylineClient` in the app's program —
  // including the `@byline/client/server` getters — then resolves to
  // `BylineClient<CollectionFieldsByPath>`. Both `@byline/generated-types`
  // and `@byline/client` must be resolvable in the consuming program; apps
  // that generate types depend on both.
  const registerLines = [
    "declare module '@byline/client' {",
    '  interface Register {',
    "    collections: import('@byline/generated-types').CollectionFieldsByPath",
    '  }',
    '}',
  ]

  return `${[
    ...importLines,
    "declare module '@byline/generated-types' {",
    ...declarationLines,
    '}',
    '',
    ...registerLines,
  ].join('\n')}\n`
}

/**
 * Emit deterministic application collection types from evaluated runtime definitions.
 * The returned hash is SHA-256 over the versioned format domain and generated module body.
 */
export function emitCollectionTypes(collections: readonly CollectionDefinition[]): {
  source: string
  hash: string
} {
  const body = emitBody(analyze(collections))
  const hash = sha256(`${HASH_DOMAIN}${body}`)
  const header = [
    '// Generated by @byline/core/codegen',
    `// Format version: ${FORMAT_VERSION}`,
    `// Hash: ${hash}`,
    '',
    '',
  ].join('\n')
  return { source: `${header}${body}`, hash }
}
