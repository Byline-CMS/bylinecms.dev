/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Examples...
//
// pnpm tsx byline/scripts/import-docs.ts ../../docs/**/*.md --dry-run
// pnpm tsx byline/scripts/import-docs.ts ../../docs/**/*.md --verbose
// pnpm tsx byline/scripts/import-docs.ts '../../docs/*.md' --dry-run --verbose
// pnpm tsx byline/scripts/import-docs.ts ../../docs/**/*.md
//
// Run tests...
//
// pnpm vitest run --mode=node byline/scripts/lib/

/**
 * Import markdown files into the `docs` collection.
 *
 *   pnpm tsx byline/scripts/import-docs.ts <path-or-glob...>
 *
 * Per-file flow:
 *   1. Read the file, split frontmatter from body with gray-matter.
 *   2. Parse the body to mdast via remark-parse + remark-gfm.
 *   3. Rewrite `./SIBLING.md[#hash]` links to `/docs/<imported-path>`
 *      using a sourcePath→docPath map built from a frontmatter pre-pass.
 *      Targets outside the batch are stripped to plain text.
 *   4. Convert mdast → Lexical SerializedEditorState.
 *   5. Resolve `featureImage` (a `media` path) to a relation envelope.
 *   6. `findByPath` to decide create vs update. On update, status and
 *      publishedOn are preserved — editorial state in Byline wins.
 *
 * Flags:
 *   --dry-run     Parse + log, no DB writes.
 *   --verbose     Print warnings for dropped/unsupported nodes.
 */

import '../load-env.js'
import '../server.config.js'

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createSuperAdminContext } from '@byline/auth'
import { type CollectionHandle, createBylineClient } from '@byline/client'
import { getCollectionDefinition, getServerConfig, slugify } from '@byline/core'
import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { type DocFrontmatter, parseDocFile } from './lib/frontmatter.js'
import { type MdastToLexicalWarning, mdastToLexical } from './lib/mdast-to-lexical.js'
import { type DocLinkRewriteWarning, rewriteDocLinks } from './lib/rewrite-doc-links.js'
import { stripLeadingH1IfMatches } from './lib/strip-leading-h1.js'

const DOCS_COLLECTION = 'docs'
const MEDIA_COLLECTION = 'media'
const DOCS_URL_PREFIX = '/docs'
const DEFAULT_IMPORT_STATUS = 'published'

interface Flags {
  dryRun: boolean
  verbose: boolean
  patterns: string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, verbose: false, patterns: [] }
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--verbose') flags.verbose = true
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`)
    else flags.patterns.push(arg)
  }
  if (flags.patterns.length === 0) {
    throw new Error('import-docs: provide at least one file path or glob (e.g. "docs/**/*.md")')
  }
  return flags
}

async function expandPatterns(patterns: string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const pattern of patterns) {
    for await (const file of glob(pattern)) {
      if (file.endsWith('.md') || file.endsWith('.markdown')) {
        out.add(resolve(file))
      }
    }
  }
  return [...out].sort()
}

function parseBodyToMdast(body: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(body) as Root
}

function logWarnings(filePath: string, warnings: MdastToLexicalWarning[]): void {
  if (warnings.length === 0) return
  console.warn(`  - ${warnings.length} warning(s) for ${filePath}:`)
  for (const w of warnings) {
    console.warn(`      [${w.kind}] ${w.detail}`)
  }
}

function logLinkWarnings(filePath: string, warnings: DocLinkRewriteWarning[]): void {
  if (warnings.length === 0) return
  console.warn(`  - ${warnings.length} link rewrite(s) for ${filePath}:`)
  for (const w of warnings) {
    if (w.kind === 'rewritten-doc-link') {
      console.warn(`      [rewrite]    ${w.href} → ${w.resolvedTo}`)
    } else if (w.kind === 'unresolved-doc-link') {
      console.warn(`      [unresolved] ${w.href}  (stripped to plain text)`)
    } else {
      console.warn(`      [empty]      '${w.href}'  (stripped to plain text)`)
    }
  }
}

interface ResolvedFeatureImage {
  targetCollectionId: string
  targetDocumentId: string
}

async function resolveFeatureImage(
  client: ReturnType<typeof createBylineClient>,
  path: string
): Promise<ResolvedFeatureImage | null> {
  const mediaCollectionId = await client.resolveCollectionId(MEDIA_COLLECTION)
  const doc = await client.collection(MEDIA_COLLECTION).findByPath(path, {
    status: 'any',
    _bypassBeforeRead: true,
  })
  if (!doc) return null
  return { targetCollectionId: mediaCollectionId, targetDocumentId: doc.id }
}

interface BuildPayloadArgs {
  frontmatter: DocFrontmatter
  lexicalState: unknown
  featureImage: ResolvedFeatureImage | null
}

function buildDocPayload({
  frontmatter,
  lexicalState,
  featureImage,
}: BuildPayloadArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: frontmatter.title,
    content: [
      {
        _type: 'richTextBlock',
        richText: lexicalState,
        constrainedWidth: frontmatter.constrainedWidth ?? true,
      },
    ],
  }
  if (frontmatter.summary !== undefined) payload.summary = frontmatter.summary
  if (frontmatter.publishedOn !== undefined) payload.publishedOn = frontmatter.publishedOn
  if (featureImage) payload.featureImage = featureImage
  return payload
}

function derivePath(frontmatter: DocFrontmatter, locale: string): string {
  if (frontmatter.path) return frontmatter.path
  return slugify(frontmatter.title, { locale, collectionPath: DOCS_COLLECTION })
}

/**
 * Walk a document's status forward to `targetStatus`. The workflow only
 * permits ±1 step transitions, so jumping draft → published has to step
 * through any intermediate statuses (e.g. needs_review). No-op when the
 * workflow doesn't include the target or when already at/past it.
 */
async function walkToStatus(
  handle: CollectionHandle,
  documentId: string,
  workflowStatuses: readonly { name: string }[],
  currentStatus: string,
  targetStatus: string
): Promise<void> {
  const currentIdx = workflowStatuses.findIndex((s) => s.name === currentStatus)
  const targetIdx = workflowStatuses.findIndex((s) => s.name === targetStatus)
  if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) return
  for (let i = currentIdx + 1; i <= targetIdx; i++) {
    await handle.changeStatus(documentId, workflowStatuses[i].name)
  }
}

interface ProcessResult {
  filePath: string
  action: 'created' | 'updated' | 'skipped'
  documentId?: string
  path: string
}

/**
 * Build a map of absolute markdown source paths → imported doc paths,
 * by reading just the frontmatter of every file in the batch. Needed so
 * the link-rewrite step in pass 2 can resolve `./SIBLING.md` to the URL
 * its target will be served at after import.
 */
function buildSourcePathMap(files: string[], defaultLocale: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const file of files) {
    try {
      const source = readFileSync(file, 'utf8')
      const parsed = parseDocFile(source, file)
      const locale = parsed.frontmatter.locale ?? defaultLocale
      map.set(file, derivePath(parsed.frontmatter, locale))
    } catch {
      // Skip — pass 2 will surface the parse error against this file.
    }
  }
  return map
}

async function processFile(
  filePath: string,
  client: ReturnType<typeof createBylineClient>,
  handle: CollectionHandle,
  flags: Flags,
  pathMap: Map<string, string>
): Promise<ProcessResult> {
  const source = readFileSync(filePath, 'utf8')
  const parsed = parseDocFile(source, filePath)
  const locale = parsed.frontmatter.locale ?? client.defaultLocale

  const mdast = stripLeadingH1IfMatches(parseBodyToMdast(parsed.body), parsed.frontmatter.title)
  const linkWarnings = rewriteDocLinks(mdast, {
    sourceFilePath: filePath,
    pathMap,
    urlPrefix: DOCS_URL_PREFIX,
  })
  if (flags.verbose) logLinkWarnings(filePath, linkWarnings)
  const { state, warnings } = mdastToLexical(mdast)
  if (flags.verbose) logWarnings(filePath, warnings)

  const featureImage = parsed.frontmatter.featureImage
    ? await resolveFeatureImage(client, parsed.frontmatter.featureImage)
    : null
  if (parsed.frontmatter.featureImage && !featureImage) {
    console.warn(
      `  - featureImage '${parsed.frontmatter.featureImage}' not found in '${MEDIA_COLLECTION}' — dropping the field`
    )
  }

  const docPath = derivePath(parsed.frontmatter, locale)
  const payload = buildDocPayload({
    frontmatter: parsed.frontmatter,
    lexicalState: state,
    featureImage,
  })

  if (flags.dryRun) {
    console.log(`  • [dry-run] would upsert '${docPath}' (locale=${locale})`)
    return { filePath, action: 'skipped', path: docPath }
  }

  // Re-imports default to the published status (overridable per-file via
  // frontmatter `status:`). `update` always resets to the workflow's
  // default status on a new version, so we walk transitions forward
  // afterwards; `create` accepts an initial status directly.
  const desiredStatus = parsed.frontmatter.status ?? DEFAULT_IMPORT_STATUS
  const definition = getCollectionDefinition(DOCS_COLLECTION)
  const workflowStatuses = definition?.workflow?.statuses ?? []
  const defaultStatus = workflowStatuses[0]?.name ?? 'draft'

  const existing = await handle.findByPath(docPath, {
    locale,
    status: 'any',
    _bypassBeforeRead: true,
  })

  if (existing) {
    // Don't clobber publishedOn if Byline already has one.
    if (existing.fields?.publishedOn) {
      delete payload.publishedOn
    }
    const result = await handle.update(existing.id, payload, {
      locale,
      // Advertise the imported locale (editorial available-locales set), merged
      // with whatever is already advertised so a later-locale re-import doesn't
      // clobber an earlier one. The public set is still gated by the version
      // completeness ledger (intersection). See docs/I18N.md.
      availableLocales: [...new Set([...(existing.availableLocales ?? []), locale])],
    })
    await walkToStatus(handle, result.documentId, workflowStatuses, defaultStatus, desiredStatus)
    return { filePath, action: 'updated', documentId: result.documentId, path: docPath }
  }

  const result = await handle.create(payload, {
    locale,
    status: desiredStatus,
    path: docPath,
    // Advertise the authoring locale; the public advertised set is the
    // intersection of this editorial set with the completeness ledger.
    availableLocales: [locale],
  })
  return { filePath, action: 'created', documentId: result.documentId, path: docPath }
}

async function run(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const files = await expandPatterns(flags.patterns)
  if (files.length === 0) {
    console.error('import-docs: no .md files matched the provided patterns.')
    process.exit(1)
  }

  console.log(`import-docs: found ${files.length} file(s)${flags.dryRun ? ' (dry-run)' : ''}.`)

  const config = getServerConfig()
  const requestContext = createSuperAdminContext({ id: 'import-docs-script' })
  const client = createBylineClient({ config, requestContext })
  const handle = client.collection(DOCS_COLLECTION)

  // Pre-pass: map each source file to the path its imported doc will
  // live at, so pass 2 can rewrite cross-doc markdown links.
  const pathMap = buildSourcePathMap(files, client.defaultLocale)

  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    try {
      const result = await processFile(file, client, handle, flags, pathMap)
      if (result.action === 'created') created += 1
      else if (result.action === 'updated') updated += 1
      else skipped += 1
      console.log(`  ✓ ${result.action.padEnd(7)} ${result.path}  ←  ${file}`)
    } catch (err) {
      failed += 1
      console.error(`  ✗ failed   ${file}`)
      console.error(err instanceof Error ? `      ${err.message}` : err)
    }
  }

  console.log(
    `import-docs: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed.`
  )
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('import-docs: fatal error')
  console.error(err)
  process.exit(1)
})
