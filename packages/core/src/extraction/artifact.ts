/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { CONTENT_HASH_PATTERN } from '../storage/content-hash.js'
import { everySlot, isCount, isIsoDateTime, isJsonValue, isPlainObject } from './internal.js'
import { type PageMapIssue, validatePageMap } from './page-map.js'

/** The persisted artifact shape this release reads and writes. */
export const EXTRACTION_ARTIFACT_SCHEMA_VERSION = 1

/**
 * A code for one broken artifact rule.
 *
 * @provisional
 */
export type ExtractionArtifactIssueCode =
  | 'invalid-shape'
  | 'unsupported-schema-version'
  | 'invalid-content-hash'
  | 'source-verified-mismatch'
  | 'invalid-provider'
  | 'invalid-provider-version'
  | 'invalid-producer-config-hash'
  | 'unrecorded-producer'
  | 'invalid-plain-text'
  | 'invalid-markdown'
  | 'invalid-structure'
  | 'invalid-page-count'
  | 'invalid-page-map'
  | 'invalid-metadata'
  | 'invalid-signals'
  | 'invalid-produced-at'

/**
 * One broken artifact rule.
 *
 * @provisional
 */
export interface ExtractionArtifactIssue {
  code: ExtractionArtifactIssueCode
  message: string
  /** The page map's own issues, for `invalid-page-map`. */
  pageMapIssues?: PageMapIssue[]
}

const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean =>
  value === undefined || check(value)

const isString = (value: unknown): boolean => typeof value === 'string'

/** Recognised members only; unknown members are ignored, as in stored evidence. */
function isValidMetadata(metadata: unknown): boolean {
  if (!isPlainObject(metadata)) return false
  const { contentType, pages, title, authors, language, createdAt, producer } = metadata
  return (
    [contentType, title, language, producer].every((member) => isOptional(member, isString)) &&
    isOptional(createdAt, isIsoDateTime) &&
    isOptional(pages, isCount) &&
    isOptional(authors, (value) => everySlot(value, isString))
  )
}

/** Recognised members only; unknown members are ignored, as in stored evidence. */
function isValidSignals(signals: unknown): boolean {
  if (!isPlainObject(signals) || !isCount(signals.totalChars)) return false
  const { charsPerPage, ocrCandidatePages, textLayerCoverage } = signals
  return (
    isOptional(charsPerPage, (value) => everySlot(value, isCount)) &&
    isOptional(ocrCandidatePages, isCount) &&
    isOptional(textLayerCoverage, (value) => typeof value === 'number' && value >= 0 && value <= 1)
  )
}

/**
 * Checks a persisted artifact. A `null` `producerConfigHash` fails unless
 * `allowUnrecordedProducer` is `true`, which only code reading or importing
 * historical records passes. A new extraction always records the real hash from its
 * `ExtractionProducerIdentity`.
 *
 * An unknown `schemaVersion` is reported alone: the artifact is unusable for reuse,
 * and its other members cannot be judged against this version's rules.
 *
 * @provisional
 */
export function validateExtractionArtifact(
  artifact: unknown,
  options?: { allowUnrecordedProducer?: boolean }
): { ok: true } | { ok: false; issues: ExtractionArtifactIssue[] } {
  const issues: ExtractionArtifactIssue[] = []
  const report = (code: ExtractionArtifactIssueCode, message: string): void => {
    issues.push({ code, message })
  }

  if (!isPlainObject(artifact)) {
    return {
      ok: false,
      issues: [{ code: 'invalid-shape', message: 'the artifact is not a plain object' }],
    }
  }
  if (artifact.schemaVersion !== EXTRACTION_ARTIFACT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          code: 'unsupported-schema-version',
          message: `schemaVersion ${String(artifact.schemaVersion)} is not supported`,
        },
      ],
    }
  }

  const { contentHash, producerConfigHash, providerVersion, plainText, pageCount } = artifact
  if (
    contentHash !== null &&
    (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash))
  ) {
    report('invalid-content-hash', 'contentHash must be a lower-case SHA-256 or null')
  }
  if (artifact.sourceVerified !== (contentHash !== null)) {
    report(
      'source-verified-mismatch',
      'sourceVerified must be true exactly when contentHash is set'
    )
  }
  if (typeof artifact.provider !== 'string' || artifact.provider === '') {
    report('invalid-provider', 'provider must be a non-empty string')
  }
  if (providerVersion !== null && typeof providerVersion !== 'string') {
    report('invalid-provider-version', 'providerVersion must be a string or null')
  }
  if (producerConfigHash === null) {
    if (options?.allowUnrecordedProducer !== true) {
      report('unrecorded-producer', 'a new artifact must record its producerConfigHash')
    }
  } else if (
    typeof producerConfigHash !== 'string' ||
    !CONTENT_HASH_PATTERN.test(producerConfigHash)
  ) {
    report('invalid-producer-config-hash', 'producerConfigHash must be a lower-case SHA-256')
  }
  if (typeof plainText !== 'string') report('invalid-plain-text', 'plainText must be a string')
  if (artifact.markdown !== undefined && typeof artifact.markdown !== 'string') {
    report('invalid-markdown', 'markdown must be a string')
  }
  if (artifact.structure !== undefined && !isJsonValue(artifact.structure)) {
    report('invalid-structure', 'structure must be a JSON value')
  }
  if (pageCount !== undefined && !isCount(pageCount)) {
    report('invalid-page-count', 'pageCount must be a non-negative integer')
  }
  if (!isValidMetadata(artifact.metadata)) {
    report('invalid-metadata', 'metadata must be an object whose known members have valid types')
  }
  if (!isValidSignals(artifact.signals)) {
    report('invalid-signals', 'signals must be an object whose known members have valid types')
  }
  if (!isIsoDateTime(artifact.producedAt)) {
    report('invalid-produced-at', 'producedAt must be an ISO 8601 date-time')
  }
  if (artifact.pageMap !== undefined && typeof plainText === 'string') {
    const pageMap = validatePageMap(
      plainText,
      artifact.pageMap,
      isCount(pageCount) ? { pageCount: pageCount as number } : undefined
    )
    if (!pageMap.ok) {
      issues.push({
        code: 'invalid-page-map',
        message: 'pageMap breaks the page map rules',
        pageMapIssues: pageMap.issues,
      })
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}
