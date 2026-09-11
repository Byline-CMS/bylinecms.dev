/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SerializedEditorState } from 'lexical'

import { normalizeValue } from '../field/normalize/normalize-value'
import type { FieldCapabilities, ScanFinding } from './types'

/**
 * Report what a field's current configuration will do with one stored
 * value.
 *
 * Runs the same `normalizeValue` the editor runs, rather than a parallel
 * rule set, so the report cannot drift from the behaviour it predicts.
 * Pure: no database, no DOM, no editor.
 */
export function scanDocument(
  value: SerializedEditorState | null | undefined,
  capabilities: FieldCapabilities,
  ids: { documentId: string; versionId: string; locale?: string; instancePath?: string }
): ScanFinding | undefined {
  if (value == null) return undefined

  // Capabilities that could not be measured produce a finding, never
  // silence. Skipping here would report the document clean on the
  // strength of never having looked at it.
  if (capabilities.supportedTypes == null) {
    const unmapped: ScanFinding = {
      collectionPath: capabilities.collectionPath,
      fieldPath: capabilities.fieldPath,
      documentId: ids.documentId,
      versionId: ids.versionId,
      adaptedTypes: [],
      refusedTypes: [],
      unmapped: true,
    }
    if (ids.locale != null) unmapped.locale = ids.locale
    if (ids.instancePath != null) unmapped.instancePath = ids.instancePath
    return unmapped
  }

  const result = normalizeValue(value, new Set(capabilities.supportedTypes))
  if (result.status === 'unchanged') return undefined

  const finding: ScanFinding = {
    collectionPath: capabilities.collectionPath,
    fieldPath: capabilities.fieldPath,
    documentId: ids.documentId,
    versionId: ids.versionId,
    adaptedTypes: result.status === 'adapted' ? result.convertedTypes : [],
    refusedTypes: result.status === 'refused' ? result.unsupportedTypes : [],
  }
  if (ids.locale != null) finding.locale = ids.locale
  if (ids.instancePath != null) finding.instancePath = ids.instancePath
  return finding
}

/** Group findings for a report: what will adapt, and what will open read-only. */
export function summarise(findings: ScanFinding[]): {
  adapted: ScanFinding[]
  refused: ScanFinding[]
  unmapped: ScanFinding[]
} {
  return {
    adapted: findings.filter(
      (finding) => finding.unmapped !== true && finding.refusedTypes.length === 0
    ),
    refused: findings.filter(
      (finding) => finding.unmapped !== true && finding.refusedTypes.length > 0
    ),
    unmapped: findings.filter((finding) => finding.unmapped === true),
  }
}
