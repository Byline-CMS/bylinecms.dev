/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type FieldCapabilities,
  type ScanFinding,
  scanDocument,
  summarise,
} from '@byline/richtext-lexical/scan'

import { toDeclarationPath } from './richtext-scan-paths.js'

export interface StoredValue {
  collectionPath: string
  documentId: string
  versionId: string
  /** Instance path as stored — `content.1.photoBlock.caption`. */
  fieldPath: string
  locale: string
  // biome-ignore lint/suspicious/noExplicitAny: a serialized editor state
  value: any
}

export interface ScanReport {
  findings: ScanFinding[]
  /** Richtext fields the schema declares that the manifest does not cover. */
  missingFromManifest: string[]
  /** Values belonging to ordinary `json` fields, correctly skipped. */
  plainJsonValues: number
}

/**
 * Decide what each stored value means, given the schema and a manifest.
 *
 * The schema decides whether a stored path is richtext at all. That
 * matters because `byline_store_json` holds plain `json` fields too, and
 * from a row alone the two are indistinguishable — so a richtext field
 * missing from a stale manifest would look exactly like an ordinary json
 * field and be skipped, reporting its documents clean without ever
 * examining them.
 *
 * Pure, so the reporting and exit decision are testable without a
 * database.
 */
export function buildScanReport(params: {
  stored: StoredValue[]
  /** `collectionPath::declarationPath` for every richtext field in the schema. */
  declared: ReadonlySet<string>
  manifestFields: FieldCapabilities[]
}): ScanReport {
  const byField = new Map<string, FieldCapabilities>()
  for (const field of params.manifestFields) {
    byField.set(`${field.collectionPath}::${field.fieldPath}`, field)
  }

  const findings: ScanFinding[] = []
  const missing = new Set<string>()
  let plainJsonValues = 0

  for (const row of params.stored) {
    const declarationPath = toDeclarationPath(row.fieldPath)
    const key = `${row.collectionPath}::${declarationPath}`

    if (!params.declared.has(key)) {
      plainJsonValues++
      continue
    }

    const known = byField.get(key)
    if (known == null) missing.add(key)

    const capabilities: FieldCapabilities = known ?? {
      collectionPath: row.collectionPath,
      fieldPath: declarationPath,
      supportedTypes: null,
      unresolvedReason: 'Not present in the manifest — regenerate it.',
    }

    const finding = scanDocument(row.value, capabilities, {
      documentId: row.documentId,
      versionId: row.versionId,
      locale: row.locale,
      instancePath: row.fieldPath,
    })
    if (finding != null) findings.push(finding)
  }

  return { findings, missingFromManifest: [...missing], plainJsonValues }
}

/**
 * Whether the scan should fail the process.
 *
 * An unexamined field is not a passing field, so unknown capabilities
 * and a stale manifest fail alongside content that would open read-only.
 */
export function shouldFail(report: ScanReport, manifestFields: FieldCapabilities[]): boolean {
  const { refused, unmapped } = summarise(report.findings)
  const unmeasured = manifestFields.filter((field) => field.supportedTypes == null)
  return (
    refused.length > 0 ||
    unmapped.length > 0 ||
    unmeasured.length > 0 ||
    report.missingFromManifest.length > 0
  )
}
