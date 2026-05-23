/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Examples...
//
// pnpm tsx --env-file=.env --env-file=.env.local byline/scripts/import-docs.ts ../../docs/**/*.md --dry-run
// pnpm tsx --env-file=.env --env-file=.env.local byline/scripts/import-docs.ts ../../docs/**/*.md --verbose
// pnpm tsx --env-file=.env --env-file=.env.local byline/scripts/import-docs.ts '../../docs/*.md' --dry-run --verbose
// pnpm tsx --env-file=.env --env-file=.env.local byline/scripts/import-docs.ts ../../docs/**/*.md
//
// Run tests...
//
// pnpm vitest run --mode=node byline/scripts/lib/

/**
 * Import markdown files into the `docs` collection.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local byline/scripts/import-docs.ts <path-or-glob...>
 *
 * Per-file flow:
 *   1. Read the file, split frontmatter from body with gray-matter.
 *   2. Parse the body to mdast via remark-parse + remark-gfm.
 *   3. Convert mdast → Lexical SerializedEditorState.
 *   4. Resolve `featureImage` (a `media` path) to a relation envelope.
 *   5. `findByPath` to decide create vs update. On update, status and
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
import { getServerConfig, slugify } from '@byline/core'
import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { type DocFrontmatter, parseDocFile } from './lib/frontmatter.js'
import { type MdastToLexicalWarning, mdastToLexical } from './lib/mdast-to-lexical.js'
import { stripLeadingH1IfMatches } from './lib/strip-leading-h1.js'

const DOCS_COLLECTION = 'docs'
const MEDIA_COLLECTION = 'media'

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
  locale: string
}

function buildDocPayload({
  frontmatter,
  lexicalState,
  featureImage,
  locale,
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
    // The `availableLanguages` field's built-in validator requires at
    // least one checked locale; without it, opening the imported doc
    // in the admin surfaces a validation error before any save. Seed
    // the authoring locale so editors land on a valid form.
    availableLanguages: { [locale]: true },
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

interface ProcessResult {
  filePath: string
  action: 'created' | 'updated' | 'skipped'
  documentId?: string
  path: string
}

async function processFile(
  filePath: string,
  client: ReturnType<typeof createBylineClient>,
  handle: CollectionHandle,
  flags: Flags
): Promise<ProcessResult> {
  const source = readFileSync(filePath, 'utf8')
  const parsed = parseDocFile(source, filePath)
  const locale = parsed.frontmatter.locale ?? client.defaultLocale

  const mdast = stripLeadingH1IfMatches(parseBodyToMdast(parsed.body), parsed.frontmatter.title)
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
    locale,
  })

  if (flags.dryRun) {
    console.log(`  • [dry-run] would upsert '${docPath}' (locale=${locale})`)
    return { filePath, action: 'skipped', path: docPath }
  }

  const existing = await handle.findByPath(docPath, {
    locale,
    status: 'any',
    _bypassBeforeRead: true,
  })

  if (existing) {
    // Editorial state wins on re-import: don't overwrite status, and
    // don't clobber publishedOn if Byline already has one.
    if (existing.fields?.publishedOn) {
      delete payload.publishedOn
    }
    const result = await handle.update(existing.id, payload, { locale })
    return { filePath, action: 'updated', documentId: result.documentId, path: docPath }
  }

  const result = await handle.create(payload, {
    locale,
    status: parsed.frontmatter.status,
    path: docPath,
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

  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    try {
      const result = await processFile(file, client, handle, flags)
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
