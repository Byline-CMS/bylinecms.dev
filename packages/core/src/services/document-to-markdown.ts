/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `documentToMarkdown` — the document-grain markdown assembler for the
 * agent-readable export surface (`.md` routes, `llms.txt`). See
 * docs/05-reading-and-delivery/04-markdown-export.md.
 *
 * A page is a composite (text, richtext, blocks, arrays, relations); this
 * walks the collection's schema and the locale-resolved field data in
 * lockstep and emits ONE markdown document: YAML frontmatter, an H1 from
 * `useAsTitle`, then fields as sections. One-way and lossy-tolerant by
 * contract — the output is read-only and never re-imported.
 *
 * Editor-agnostic: rich-text leaves are delegated to the registered
 * `RichTextToMarkdownFn` (the seam beside `embed` / `populate` in
 * `ServerConfig.fields.richText`), passed in explicitly via options so
 * this module stays pure and unit-testable without `initBylineCore()`.
 * Routing knowledge stays out of core the same way: relation and file
 * URLs resolve through caller-supplied callbacks.
 *
 * Rendering rules (the format contract — see the unit tests):
 *   - `useAsTitle` field → frontmatter `title` + body `# H1` (not repeated
 *     as a section).
 *   - A field named `summary` → frontmatter `description` + an unlabelled
 *     lead paragraph (the standfirst).
 *   - `richText` fields and `blocks` fields render their content directly,
 *     with no `## Label` heading — they ARE the document body.
 *   - Scalar fields (text, textArea, datetime, select, checkbox, numbers)
 *     → `**Label:** value` lines.
 *   - `relation` → `**Label:** [title](url)` when populated + resolvable.
 *   - `image` / `file` → `![alt](url)`.
 *   - `group` → `## Label` + nested walk; `array` → `## Label` + items.
 *   - Empty values are skipped entirely — no empty headings.
 */

import {
  type CollectionDefinition,
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
  type RichTextToMarkdownFn,
} from '../@types/index.js'

export interface MarkdownSourceDocument {
  /** The document's URL slug (`byline_document_paths` projection). */
  path?: string
  /** Locale-resolved, camelCase field data (the `ClientDocument.fields` shape). */
  fields: Record<string, any>
  updatedAt?: Date | string
}

export interface DocumentToMarkdownOptions {
  /**
   * The content locale this render represents (one `.md` variant per
   * content locale — same cache key dimension as the HTML page).
   */
  locale?: string
  /** Absolute canonical URL of the HTML page; emitted into frontmatter. */
  canonicalUrl?: string
  /**
   * Rich-text serializer (the `ServerConfig.fields.richText.toMarkdown`
   * seam). Without it, rich-text leaves are skipped.
   */
  richTextToMarkdown?: RichTextToMarkdownFn
  /**
   * Resolve a relation target to a public URL. Receives the target's
   * collection path and document slug; return `undefined` to render the
   * relation as plain text (no link).
   */
  resolveUrl?: (collectionPath: string, documentPath: string) => string | undefined
  /**
   * Resolve an upload field value (`StoredFileValue`) to a public URL.
   * Falls back to the value's own `storageUrl`; the image is skipped when
   * neither yields a URL.
   */
  resolveFileUrl?: (value: Record<string, any>) => string | undefined
  /** Extra frontmatter entries, merged after the standard keys. */
  frontmatter?: Record<string, unknown>
}

/**
 * Render one document to a markdown string (frontmatter + body).
 */
export function documentToMarkdown(
  doc: MarkdownSourceDocument,
  definition: CollectionDefinition,
  options: DocumentToMarkdownOptions = {}
): string {
  const ctx: Ctx = { definition, options }
  const fields = doc.fields ?? {}

  const title = stringValue(resolveLocalized(fields[definition.useAsTitle ?? ''], options.locale))
  const summary = stringValue(resolveLocalized(fields.summary, options.locale))
  const published = dateValue(resolveLocalized(fields.publishedOn, options.locale))

  // --- frontmatter -------------------------------------------------------
  const fm: Record<string, unknown> = {}
  if (title) fm.title = title
  if (summary) fm.description = summary
  if (options.canonicalUrl) fm.canonical = options.canonicalUrl
  if (options.locale) fm.locale = options.locale
  fm.collection = definition.path
  if (published) fm.published = published
  const updated = dateValue(doc.updatedAt)
  if (updated) fm.updated = updated
  Object.assign(fm, options.frontmatter ?? {})

  // --- body ---------------------------------------------------------------
  const blocks: string[] = []
  if (title) blocks.push(`# ${title}`)
  if (summary) blocks.push(summary)

  // Fields already represented above never repeat as sections.
  const handled = new Set([definition.useAsTitle, 'summary', 'publishedOn'])
  blocks.push(...serializeFieldSet(definition.fields, fields, ctx, 2, handled))

  return `${renderFrontmatter(fm)}\n\n${blocks.join('\n\n')}\n`
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Ctx {
  definition: CollectionDefinition
  options: DocumentToMarkdownOptions
}

function serializeFieldSet(
  fields: FieldSet,
  data: Record<string, any>,
  ctx: Ctx,
  level: number,
  skip?: Set<string | undefined>
): string[] {
  const out: string[] = []
  for (const field of fields) {
    if (skip?.has(field.name)) continue
    const value = resolveLocalized(data?.[field.name], ctx.options.locale)
    if (isEmpty(value)) continue
    const rendered = serializeField(field, value, ctx, level)
    if (rendered != null && rendered.length > 0) out.push(rendered)
  }
  return out
}

function serializeField(field: Field, value: unknown, ctx: Ctx, level: number): string | null {
  if (isGroupField(field)) {
    const inner = serializeFieldSet(field.fields, asRecord(value), ctx, level + 1)
    if (inner.length === 0) return null
    return [heading(level, field.label ?? field.name), ...inner].join('\n\n')
  }

  if (isArrayField(field)) {
    if (!Array.isArray(value) || value.length === 0) return null
    const items = value
      .map((item) => serializeFieldSet(field.fields, asRecord(item), ctx, level + 1).join('\n\n'))
      .filter((s) => s.length > 0)
    if (items.length === 0) return null
    return [heading(level, field.label ?? field.name), ...items].join('\n\n')
  }

  if (isBlocksField(field)) {
    if (!Array.isArray(value) || value.length === 0) return null
    const rendered: string[] = []
    for (const item of value) {
      const record = asRecord(item)
      const block = field.blocks.find((b) => b.blockType === record._type)
      if (block == null) continue
      // Blocks are the document body: their fields render directly, with
      // no per-block heading and no `**Label:**` prefix for richtext.
      const inner = serializeFieldSet(block.fields, record, ctx, level)
      if (inner.length > 0) rendered.push(inner.join('\n\n'))
    }
    return rendered.length > 0 ? rendered.join('\n\n') : null
  }

  switch (field.type) {
    case 'richText': {
      const toMarkdown = ctx.options.richTextToMarkdown
      if (toMarkdown == null) return null
      const markdown = toMarkdown({
        value,
        fieldPath: field.name,
        collectionPath: ctx.definition.path,
      })
      return markdown.trim().length > 0 ? markdown.trim() : null
    }
    case 'relation':
      return serializeRelation(field, value, ctx)
    case 'image':
    case 'file':
      return serializeUpload(field, value, ctx)
    case 'date':
    case 'time':
    case 'datetime': {
      const iso = dateValue(value)
      return iso ? labelled(field, iso) : null
    }
    case 'checkbox':
    case 'boolean':
    case 'json':
    case 'object':
      // No markdown projection: booleans are almost always presentation
      // toggles (constrainedWidth, featured) and json/object is
      // machine-shaped — the export renders content, not configuration.
      return null
    case 'code': {
      // Fenced code block. The info string uses the schema's static
      // `language` hint when present; a sibling `languageField` selection is
      // not resolvable here (this serializer sees one field at a time), so
      // those fences render bare — still valid markdown.
      const text = stringValue(value)
      if (text == null) return null
      return `\`\`\`${field.language ?? ''}\n${text}\n\`\`\``
    }
    default: {
      const text = stringValue(value)
      return text ? labelled(field, text) : null
    }
  }
}

function serializeRelation(field: Field, value: unknown, ctx: Ctx): string | null {
  const record = asRecord(value)
  const target = asRecord(record.document)
  const targetFields = asRecord(target.fields)
  const displayField = (field as { displayField?: string }).displayField
  const title =
    stringValue(displayField ? targetFields[displayField] : undefined) ??
    stringValue(targetFields.title) ??
    stringValue(target.path)
  if (record._resolved !== true || title == null) return null
  const targetCollection = (field as { targetCollection?: string }).targetCollection
  const url =
    targetCollection && typeof target.path === 'string'
      ? ctx.options.resolveUrl?.(targetCollection, target.path)
      : undefined
  return labelled(field, url ? `[${title}](${url})` : title)
}

function serializeUpload(field: Field, value: unknown, ctx: Ctx): string | null {
  const record = asRecord(value)
  const url = ctx.options.resolveFileUrl?.(record) ?? stringValue(record.storageUrl)
  if (url == null) return null
  const alt =
    stringValue(record.alt) ??
    stringValue(record.originalFilename) ??
    stringValue(field.label) ??
    field.name
  return `![${alt.replace(/[[\]]/g, '')}](${url})`
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/**
 * Locale-scoped reads deliver flat values; `locale: 'all'` reads deliver
 * `{ en: …, fr: … }` envelopes. Pick the requested locale (or the first
 * available) when an envelope sneaks through, so the export never prints
 * `[object Object]`.
 */
function resolveLocalized(value: unknown, locale?: string): unknown {
  if (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  ) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    const localeLike = keys.length > 0 && keys.every((k) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k))
    if (localeLike) {
      if (locale && locale in record) return record[locale]
      return record[keys[0] as string]
    }
  }
  return value
}

function asRecord(value: unknown): Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if (typeof value === 'number') return String(value)
  return null
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function heading(level: number, text: string): string {
  return `${'#'.repeat(Math.min(level, 6))} ${text}`
}

function labelled(field: Field, value: string): string {
  return `**${field.label ?? field.name}:** ${value}`
}

/** Minimal YAML emitter — flat keys, quoted strings, no nesting needed. */
function renderFrontmatter(entries: Record<string, unknown>): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(entries)) {
    if (value == null) continue
    if (typeof value === 'string') {
      lines.push(`${key}: "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    } else {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}
