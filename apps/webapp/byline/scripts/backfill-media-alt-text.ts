/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Backfill `altText` on media documents that predate the import script
 * supplying it (see `lib/media-ingest.ts`).
 *
 *   pnpm tsx byline/scripts/backfill-media-alt-text.ts '../../docs/**\/*.md'
 *   pnpm tsx byline/scripts/backfill-media-alt-text.ts '../../docs/**\/*.md' --apply
 *
 * `altText` is required by the media collection, so a document missing one
 * cannot be saved again — not by an editor, and not by `regenerate-media.ts`,
 * which replaces the image on a document whose other fields it carries forward
 * unchanged. Those documents are stuck until the value is supplied.
 *
 * The repair is deliberately narrow:
 *
 *   - It only fills an absent or blank `altText`. A document that already has
 *     one is left alone, so editorial text is never overwritten.
 *   - Values come from the markdown that introduced the image — the `![alt]`
 *     text an author already wrote — matched to the media document by the same
 *     filename-derived path the importer dedupes on. An image with no markdown
 *     alt is reported and skipped rather than filled with a guess.
 *   - Writes go through `replaceDocumentFieldsPreservingStatus` with the
 *     revision observed in the same pass, so a document edited concurrently is
 *     rejected rather than clobbered, and a published item is not demoted to
 *     draft by the repair.
 *
 * Reports what it would do and exits without writing unless `--apply` is given.
 */

import '../load-env.js'
import '../server.config.js'

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createSuperAdminContext } from '@byline/auth'
import { createBylineClient } from '@byline/client'
import { getCollectionDefinition, getServerConfig, slugify } from '@byline/core'
import {
  type DocumentLifecycleContext,
  replaceDocumentFieldsPreservingStatus,
} from '@byline/core/services'

import { parseDocFile } from './lib/frontmatter.js'
import { type AltTextSources, collectAltTextSources } from './lib/media-alt-text-sources.js'
import { mediaPathForUrl } from './lib/media-ingest.js'

const MEDIA_COLLECTION = 'media'

/**
 * Read the markdown sources and resolve one description per media document.
 *
 * Files are sorted before they are read, matching the importer, so a run does
 * not depend on the order the filesystem enumerates a glob; `collectAltTextSources`
 * then refuses to choose between genuinely different descriptions rather than
 * letting that order decide.
 */
async function readAltTextSources(
  patterns: string[],
  defaultLocale: string
): Promise<AltTextSources> {
  const files = new Set<string>()
  for (const pattern of patterns) {
    for await (const file of glob(pattern)) {
      if (file.endsWith('.md') || file.endsWith('.markdown')) files.add(resolve(file))
    }
  }

  const documents: Array<{ file: string; body: string }> = []
  for (const file of [...files].sort()) {
    try {
      documents.push({ file, body: parseDocFile(readFileSync(file, 'utf8'), file).body })
    } catch (err) {
      // One malformed file must not deny every other document its repair.
      console.warn(`  ? ${file} — unreadable, skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  return collectAltTextSources(documents, (url) =>
    mediaPathForUrl(url, (value) =>
      slugify(value, { locale: defaultLocale, collectionPath: MEDIA_COLLECTION })
    )
  )
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const patterns = args.filter((arg) => !arg.startsWith('--'))
  if (patterns.length === 0) {
    console.error('backfill-media-alt-text: pass the markdown path(s) the images came from.')
    process.exit(1)
  }

  const config = getServerConfig()
  const definition = getCollectionDefinition(MEDIA_COLLECTION)
  if (definition == null) {
    throw new Error(`backfill-media-alt-text: collection '${MEDIA_COLLECTION}' is not registered`)
  }
  const requestContext = createSuperAdminContext({ id: 'backfill-media-alt-text' })
  const client = createBylineClient({ config, requestContext })
  const handle = client.collection(MEDIA_COLLECTION)
  const { id: collectionId, version: collectionVersion } =
    await client.resolveCollectionRecord(MEDIA_COLLECTION)

  const { altByPath, conflicts } = await readAltTextSources(patterns, client.defaultLocale)
  console.log(`backfill-media-alt-text: ${altByPath.size} image(s) with alt text in the sources.`)
  for (const conflict of conflicts) {
    console.warn(
      `  ! ${conflict.mediaPath} — described ${conflict.candidates.length} ways; skipping:`
    )
    for (const candidate of conflict.candidates) {
      console.warn(`      ${candidate.file}: "${candidate.alt}"`)
    }
  }

  const ctx: DocumentLifecycleContext = {
    db: config.db,
    definition,
    collectionId,
    collectionVersion,
    collectionPath: MEDIA_COLLECTION,
    storage: config.storage,
    logger: client.logger,
    defaultLocale: config.i18n.content.defaultLocale,
    slugifier: config.slugifier,
    requestContext,
  }

  let filled = 0
  let unmatched = 0
  let intact = 0
  const failures: Error[] = []

  for (let page = 1; ; page++) {
    const result = await handle.findForEdit({
      locale: 'all',
      page,
      pageSize: 100,
      _bypassBeforeRead: true,
    })
    for (const doc of result.docs) {
      const current = (doc.fields as Record<string, unknown>).altText
      if (typeof current === 'string' && current.trim() !== '') {
        intact += 1
        continue
      }
      const alt = altByPath.get(doc.path)
      if (alt == null) {
        unmatched += 1
        const contested = conflicts.some((conflict) => conflict.mediaPath === doc.path)
        console.warn(
          `  ? ${doc.path} — ${contested ? 'conflicting descriptions' : 'no markdown alt text found'}; leaving it for an editor`
        )
        continue
      }
      if (!apply) {
        console.log(`  • [dry-run] ${doc.path} ← "${alt}"`)
        filled += 1
        continue
      }
      try {
        await replaceDocumentFieldsPreservingStatus(ctx, {
          documentId: doc.id,
          data: { ...doc.fields, altText: alt },
          expectedRevision: doc.revision,
        })
        console.log(`  ✓ ${doc.path} ← "${alt}"`)
        filled += 1
      } catch (err) {
        failures.push(new Error(`backfill-media-alt-text: '${doc.path}' failed`, { cause: err }))
        console.error(`  ✗ ${doc.path}:`, err instanceof Error ? err.message : err)
      }
    }
    if (result.docs.length < 100) break
  }

  console.log(
    `backfill-media-alt-text: ${filled} ${apply ? 'filled' : 'would fill'}, ` +
      `${intact} already set, ${unmatched} without a source, ${failures.length} failed.`
  )
  if (!apply && filled > 0) console.log('Re-run with --apply to write these values.')
  if (failures.length > 0) throw new AggregateError(failures, 'backfill-media-alt-text failed')
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-media-alt-text failed:', err)
    process.exit(1)
  })
