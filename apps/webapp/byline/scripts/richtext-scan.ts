/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pre-upgrade check: which stored richtext values will a field's current
 * configuration no longer accept?
 *
 * Narrowing a richtext field changes what it accepts, so a document
 * written under a wider configuration may be adapted when an editor
 * opens it, or may open read-only if it holds something with no safe
 * conversion. This reports both, before an upgrade rather than after.
 *
 * Two steps, because capabilities and content are established
 * differently. Measuring what a field accepts means building its editor,
 * which needs a DOM and a React-capable module graph; scanning stored
 * values needs a database. So:
 *
 *   1. cd apps/webapp && pnpm byline:richtext-manifest
 *   2. cd apps/webapp && pnpm tsx byline/scripts/richtext-scan.ts
 *
 * Step 1 runs in jsdom and needs no browser and no running application,
 * so it works against a production configuration. `/admin/richtext-capabilities`
 * is an interactive equivalent for seeing why a field measured as it
 * did, but it is development-only.
 *
 * Reads only. Exits non-zero when any value would make a field
 * read-only, or when any field's capabilities are unknown, so it can
 * gate a deployment.
 *
 * See docs/09-admin-ui/04-richtext-capabilities.md.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import '../load-env.js'
import '../server.config.js'

import {
  type Field,
  formatDeclarationPath,
  getServerConfig,
  toDeclarationSegments,
  walkFieldDeclarations,
} from '@byline/core'
import type { PgAdapter } from '@byline/db-postgres'
import {
  type CapabilityManifest,
  type FieldCapabilities,
  type ScanFinding,
  summarise,
} from '@byline/richtext-lexical/scan'

import { buildScanReport, shouldFail } from './lib/richtext-scan-report.js'

const MANIFEST_PATH = resolve(process.argv[2] ?? 'byline/generated/richtext-capabilities.json')

/**
 * Every richtext field declared by the server schema, as
 * `collectionPath::declarationPath`.
 *
 * `byline_store_json` holds plain `json` fields as well as richtext ones,
 * and from a stored row the two are indistinguishable. Without the
 * schema, a richtext field missing from a stale manifest looks exactly
 * like an ordinary json field and gets skipped — reporting its documents
 * clean on the strength of never having examined them.
 */
function declaredRichTextFields(): Set<string> {
  const declared = new Set<string>()
  // biome-ignore lint/suspicious/noExplicitAny: server config shape varies by host
  const collections = (getServerConfig() as any).collections ?? []
  for (const collection of collections) {
    walkFieldDeclarations(collection.fields as Field[], (field, segments) => {
      if (field.type !== 'richText') return
      declared.add(`${collection.path}::${formatDeclarationPath(toDeclarationSegments(segments))}`)
    })
  }
  return declared
}

interface StoredValue {
  collectionPath: string
  documentId: string
  versionId: string
  fieldPath: string
  locale: string
  // biome-ignore lint/suspicious/noExplicitAny: a serialized editor state
  value: any
}

/**
 * Every stored richtext value, across every version and locale.
 *
 * Archived versions are included deliberately: an editor restoring one
 * loads it exactly as a current version is loaded, so a stray structure
 * there is just as reachable.
 */
async function readStoredValues(db: PgAdapter): Promise<StoredValue[]> {
  // The pg pool rather than Drizzle: this is one read-only query, and
  // `drizzle-orm` is not a dependency of the app.
  const result = await db.pool.query<{
    collection_path: string
    document_id: string
    document_version_id: string
    field_path: string
    locale: string
    // biome-ignore lint/suspicious/noExplicitAny: a serialized editor state
    value: any
  }>(`
    SELECT
      c.path            AS collection_path,
      dv.document_id    AS document_id,
      j.document_version_id,
      j.field_path,
      j.locale,
      j.value
    FROM byline_store_json j
    JOIN byline_document_versions dv ON dv.id = j.document_version_id
    JOIN byline_collections c ON c.id = j.collection_id
    ORDER BY c.path, dv.document_id, j.document_version_id, j.field_path, j.locale
  `)

  return result.rows.map((row) => ({
    collectionPath: row.collection_path,
    documentId: row.document_id,
    versionId: row.document_version_id,
    fieldPath: row.field_path,
    locale: row.locale,
    value: row.value,
  }))
}

function describe(finding: ScanFinding): string {
  const locale =
    finding.locale != null && finding.locale !== 'default' ? ` [${finding.locale}]` : ''
  // The instance path, so two affected captions in one version are
  // distinguishable; the declaration path alone cannot tell them apart.
  const path = finding.instancePath ?? finding.fieldPath
  const what =
    finding.unmapped === true
      ? 'capabilities unknown — not examined'
      : finding.refusedTypes.length > 0
        ? `read-only: ${finding.refusedTypes.join(', ')}`
        : `adapts: ${finding.adaptedTypes.join(', ')}`
  return `    ${path}${locale}  doc ${finding.documentId}  version ${finding.versionId}\n      ${what}`
}

async function run(): Promise<void> {
  let manifest: CapabilityManifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as CapabilityManifest
  } catch {
    console.error(
      `Could not read a capability manifest at ${MANIFEST_PATH}.\n` +
        'Generate one with: pnpm byline:richtext-manifest'
    )
    process.exitCode = 1
    return
  }

  // Keyed by collection + declaration path. A richtext field absent from
  // this map is reported, never skipped: the manifest lists every
  // richtext field, including ones whose capabilities could not be
  // measured, so an unknown key means the manifest is stale.
  const byField = new Map<string, FieldCapabilities>()
  for (const field of manifest.fields) {
    byField.set(`${field.collectionPath}::${field.fieldPath}`, field)
  }

  const db = getServerConfig().db as PgAdapter
  const declared = declaredRichTextFields()
  const stored = await readStoredValues(db)

  const report = buildScanReport({ stored, declared, manifestFields: manifest.fields })
  const { findings, missingFromManifest, plainJsonValues } = report

  const { adapted, refused, unmapped } = summarise(findings)

  console.log(
    `Manifest: ${manifest.fields.length} richtext field(s), generated ${manifest.generatedAt}`
  )
  console.log(`Schema:   ${declared.size} richtext field(s) declared`)
  console.log(
    `Scanned:  ${stored.length} stored JSON value(s) — ${plainJsonValues} plain json, skipped\n`
  )

  const byCollection = new Map<string, ScanFinding[]>()
  for (const finding of findings) {
    const list = byCollection.get(finding.collectionPath) ?? []
    list.push(finding)
    byCollection.set(finding.collectionPath, list)
  }

  if (findings.length === 0) {
    console.log('✓ Every richtext value was examined, and none needs adapting.')
  } else {
    for (const [collectionPath, list] of byCollection) {
      console.log(`  ${collectionPath}`)
      for (const finding of list) console.log(describe(finding))
    }
    console.log('')
  }

  console.log(`Will adapt on open:     ${adapted.length}`)
  console.log(`Will open read-only:    ${refused.length}`)
  console.log(`Capabilities unknown:   ${unmapped.length}`)

  const unmeasured = manifest.fields.filter((field) => field.supportedTypes == null)
  if (unmeasured.length > 0) {
    console.log('\nFields whose capabilities could not be measured:')
    for (const field of unmeasured) {
      console.log(
        `  ${field.collectionPath}.${field.fieldPath} — ${field.unresolvedReason ?? 'no reason recorded'}`
      )
    }
  }

  if (missingFromManifest.length > 0) {
    console.log(
      `\nStale manifest: ${missingFromManifest.length} richtext field(s) the schema declares ` +
        'are missing from it. Regenerate at /admin/richtext-capabilities:'
    )
    for (const key of missingFromManifest) console.log(`  ${key.replace('::', '.')}`)
  }

  if (shouldFail(report, manifest.fields)) {
    process.exitCode = 1
  }

  await db.pool.end()
}

run()
