/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The extraction-provider seam: the contract that makes document extractors
 * interchangeable drivers, in the same way `SearchProvider` makes search engines
 * interchangeable.
 *
 * Every export in this module is **provisional**. Until the contract is declared
 * stable, a minor release may change it, and the changelog will say so.
 * `ExtractionArtifact.schemaVersion` and `PageMapV1.version` version the persisted
 * shapes independently of the package version.
 *
 * A provider is a pure `bytes -> output` driver. It never reads Byline documents,
 * storage, search or access state, never persists anything and never decides
 * eligibility. Those duties belong to orchestration.
 */

import type { JsonValue } from './field-data-types.js'
import type { StorageValidator } from './storage-types.js'

/**
 * What a driver supports. Consumers gate on it and never assume it. A provider
 * that declares `markdown`, `structure` or `pageMap` as `false` must not emit that
 * member of its result.
 *
 * @provisional
 */
export interface ExtractorCapabilities {
  /** Recognises text on image-only pages. */
  ocr: boolean
  /** Emits structure-aware markdown. */
  markdown: boolean
  /** Reconstructs table structure. */
  tables: boolean
  /** Recognises formulas. */
  formulas: boolean
  /** Attempts figure and chart understanding. */
  charts: boolean
  /** Reports block positions or reading order. */
  coordinates: boolean
  /** Emits a page map version 1 from a page-aware assembly. */
  pageMap: boolean
  /** Emits provider-native `structure`. */
  structure: boolean
  /** Accepted MIME types; `*` + `/*` or `type/*` wildcards are allowed. */
  formats: string[]
}

/**
 * Hints a driver can act on.
 *
 * @provisional
 */
export interface ExtractionHints {
  /** The extension is a parser-selection hint. */
  filename?: string
  /** The declared type; a parser-selection hint. */
  mimeType?: string
  /** BCP 47; selects an OCR model. */
  language?: string
  /** An explicit OCR language list, when it differs from `language`. */
  ocrLanguages?: string[]
}

/**
 * The name of one extraction hint.
 *
 * @provisional
 */
export type ExtractionHintName = keyof ExtractionHints

/**
 * One file to extract.
 *
 * @provisional
 */
export interface ExtractionInput extends ExtractionHints {
  /**
   * Verified source bytes: a web stream for large files, or a byte array. A
   * provider consumes the stream to its end or cancels it. The caller owns any
   * spool file behind it.
   */
  data: ReadableStream<Uint8Array> | Uint8Array
  /** Aborts the extraction. The provider releases its resources. */
  signal?: AbortSignal
}

/**
 * Document-level metadata a driver recovered from the file.
 *
 * @provisional
 */
export interface ExtractionMetadata {
  /** Detected MIME type. */
  contentType?: string
  /** Pages as reported by the file's metadata. Prefer `pageCount` on the result. */
  pages?: number
  title?: string
  authors?: string[]
  /** Declared or detected language, as embedded. */
  language?: string
  /** ISO 8601. A provider that cannot normalise an embedded date omits this member. */
  createdAt?: string
  /** The producing application. */
  producer?: string
}

/**
 * Cheap classification inputs for a router. They are not page boundaries:
 * `charsPerPage` must never be used to derive page-map offsets, because it is
 * counted over text that is normalised afterwards.
 *
 * @provisional
 */
export interface RoutingSignals {
  totalChars: number
  charsPerPage?: number[]
  ocrCandidatePages?: number
  /** Share of pages with a usable text layer, from 0 to 1. */
  textLayerCoverage?: number
}

/**
 * A page map locates each physical page of a paginated source within `plainText`.
 * Offsets are half-open UTF-16 code-unit indices. `validatePageMap` checks the
 * structure; only sentinel verification against a fixture proves that page 3's
 * text came from physical page 3.
 *
 * @provisional
 */
export interface PageMapV1 {
  version: 1
  assembly: {
    /** Inserted between consecutive ranges. */
    pageSeparator: string
    /** What follows the last page. */
    trailing?: 'embedded' | 'none'
  }
  pages: Array<{ index: number; label?: string; charStart: number; charEnd: number }>
  unanchored?: Array<{ kind: string; charStart: number; charEnd: number }>
  blocks?: Array<{ page: number; charStart: number; charEnd: number; kind: string }>
}

/**
 * The normalised output of one extraction.
 *
 * @provisional
 */
export interface ExtractionResult {
  /** Equals `ExtractionProvider.name`. */
  provider: string
  /**
   * The engine version as reported at run time. Absent when the provider cannot
   * report it. A provider that implements `resolveVersion` reports the same value.
   */
  providerVersion?: string
  /** Always present; `''` when nothing is extractable. */
  plainText: string
  /** Only when `capabilities.markdown`. */
  markdown?: string
  /** Provider-native and opaque. Only when `capabilities.structure`. */
  structure?: JsonValue
  /** Only when `capabilities.pageMap`. */
  pageMap?: PageMapV1
  /** Physical pages, when the format has pages. */
  pageCount?: number
  metadata: ExtractionMetadata
  signals: RoutingSignals
}

/**
 * An extraction driver.
 *
 * @provisional
 */
export interface ExtractionProvider {
  /** Stable driver identifier, recorded on every result. */
  readonly name: string
  /** What the driver supports. */
  readonly capabilities: ExtractorCapabilities
  /**
   * Effective output-affecting configuration, as JSON. Included in the producer
   * configuration hash. Omit secrets and endpoints.
   */
  readonly configuration?: Readonly<Record<string, JsonValue>>
  /** Hints from `ExtractionHints` that change this driver's output. */
  readonly outputAffectingHints?: readonly ExtractionHintName[]
  /**
   * The engine version `extract` would report now, without extracting. Rejects
   * with an `infrastructure` error when the service cannot answer.
   */
  resolveVersion?(options?: { signal?: AbortSignal }): Promise<string>
  /** Extracts one file. Rejects with `ExtractionProviderError` on failure. */
  extract(input: ExtractionInput): Promise<ExtractionResult>
  /** Boot-time health check for a remote service. */
  ping?(): Promise<void>
}

/**
 * Whether a provider failure describes the input file or its infrastructure.
 * An `infrastructure` failure must not record the file as bad and must preserve
 * existing artifacts.
 *
 * @provisional
 */
export type ExtractionFailureScope = 'file' | 'infrastructure'

/**
 * The persisted output of one successful extraction. Document, version, path,
 * access, selection and verification evidence are deliberately absent: they belong
 * to references, so one artifact can serve every authorised reference to the same
 * bytes and producer. An artifact is immutable.
 *
 * A reader that meets an unknown `schemaVersion` treats the artifact as unusable
 * for reuse, never as malformed source data.
 *
 * @provisional
 */
export interface ExtractionArtifact {
  schemaVersion: 1
  /** SHA-256 of the source bytes; `null` only for legacy imports. */
  contentHash: string | null
  /** `true` exactly when `contentHash` came from a verified read. */
  sourceVerified: boolean
  provider: string
  providerVersion: string | null
  /**
   * `null` only for a historical import whose configuration was never recorded. A
   * new extraction always records the hash from its producer identity. A current
   * hash is never written onto historical output.
   */
  producerConfigHash: string | null
  plainText: string
  markdown?: string
  structure?: JsonValue
  pageMap?: PageMapV1
  pageCount?: number
  metadata: ExtractionMetadata
  signals: RoutingSignals
  /** ISO 8601. */
  producedAt: string
}

/**
 * The stored object cannot be confirmed to be the file the document records.
 *
 * @provisional
 */
export type SourceIdentityProblem = 'missing-hash' | 'missing-object' | 'hash-mismatch'

/**
 * Why a source could not be read. None of these says anything about the file.
 *
 * @provisional
 */
export type SourceUnavailableReason =
  | 'download-unsupported'
  | 'provider-mismatch'
  | 'read-failed'
  | 'aborted'

/**
 * Why a read that expected a validator fell back to one unconditional read. A
 * changed token does not prove changed content; the hash decides.
 *
 * @provisional
 */
export type PreconditionFallbackReason = 'changed' | 'unsupported-kind' | 'unestablishable'

/**
 * The record that binds an extraction to one verified read at one time. It is not
 * continuous storage monitoring, and a hash copied from the saved file value is not
 * evidence. It is persisted with the reference, never on the immutable artifact.
 *
 * @provisional
 */
export interface SourceVerificationEvidence {
  /** The reference's `fileHash` at read time. */
  expectedHash: string
  /** SHA-256 measured from the bytes read; equals `expectedHash`. */
  contentHash: string
  /** The validator returned with those bytes. */
  validator: StorageValidator
  /** ISO 8601. */
  verifiedAt: string
  size?: number
  readBasis?: 'expected' | 'unconditional' | 'fallback'
  preconditionFallback?: PreconditionFallbackReason
}

/**
 * Why extraction work is required.
 *
 * @provisional
 */
export type ExtractionWorkReason =
  | 'force'
  /** Nothing usable exists for this reference and producer. */
  | 'no-artifact'
  /** The last attempt failed or hit an identity problem. */
  | 'previous-attempt-unsuccessful'
  /** The reference's `fileHash` differs from the artifact's `contentHash`. */
  | 'source-changed'
  /** There is no valid evidence for the current hash. */
  | 'unverified'
  /** The provider, version or configuration hash differs. */
  | 'producer-changed'
  /** The artifact's `schemaVersion` is not the current one. */
  | 'schema-changed'

/**
 * The result of `decideExtractionWork`.
 *
 * `versionUnchecked` is reduced assurance: the current engine version and the
 * deployment identifier are both unknown, so an engine upgrade is not detected.
 * `producerUnchecked` is reduced assurance of the same kind, and is `true` only for
 * historical output with no recorded configuration: that configuration was not
 * compared, and a `null` recorded engine version was not compared either.
 *
 * @provisional
 */
export type ExtractionWorkDecision =
  | { kind: 'identity-problem'; problem: 'missing-hash' }
  | { kind: 'work'; reasons: ExtractionWorkReason[]; versionUnchecked: boolean }
  | {
      kind: 'reuse'
      evidence: SourceVerificationEvidence
      versionUnchecked: boolean
      producerUnchecked: boolean
    }

/**
 * Why a promotion was refused.
 *
 * @provisional
 */
export type PromotionRefusalReason =
  | 'hash-changed'
  | 'version-changed'
  | 'access-changed'
  | 'artifact-mismatch'
  | 'claim-lost'

/**
 * Was the source verified, and was extraction reused, completed, unavailable,
 * blocked or refused?
 *
 * @provisional
 */
export type DerivationOutcome =
  | { kind: 'reused' }
  | { kind: 'extracted' }
  | { kind: 'identity-problem'; problem: SourceIdentityProblem }
  | { kind: 'source-unavailable'; reason: SourceUnavailableReason }
  | { kind: 'provider-failed'; failureScope: ExtractionFailureScope; retryable: boolean }
  | { kind: 'promotion-refused'; reason: PromotionRefusalReason }

/**
 * Whether making previously eligible text ineligible was durably recorded.
 *
 * @provisional
 */
export type EligibilityUpdateOutcome =
  /** Nothing previously eligible became ineligible. */
  | { kind: 'not-required' }
  /** Ineligibility was durably recorded. */
  | { kind: 'recorded' }
  /** Recording failed; the join still includes the old text. */
  | { kind: 'failed' }

/**
 * Whether search reflects the current eligible selection. `written` means the
 * provider acknowledged a write. It is not a durable exclusion guarantee.
 *
 * @provisional
 */
export type ProjectionOutcome =
  | { kind: 'written' }
  | { kind: 'pending'; reason: 'write-failed' | 'not-attempted' | 'stale-write' }

/**
 * Whether ineligible text has left search. Derive it only with `exclusionState`.
 * `excluded` means the eventual level succeeded for this write; it is not the
 * durable read-time guarantee.
 *
 * @provisional
 */
export type ExclusionState =
  | { state: 'not-required' }
  | { state: 'excluded' }
  | {
      state: 'pending'
      reason: 'eligibility-update-failed' | 'write-failed' | 'not-attempted' | 'stale-write'
    }

/**
 * The independent facts about one attachment after processing. A save, an extraction
 * and a search update cannot be reported with one `success` flag.
 *
 * @provisional
 */
export interface AttachmentProcessingReport {
  documentId: string
  documentVersionId?: string
  storagePath: string
  runId?: string
  derivation: DerivationOutcome
  eligibility?: EligibilityUpdateOutcome
  projection?: ProjectionOutcome
  exclusion?: ExclusionState
}
