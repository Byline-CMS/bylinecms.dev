/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { EXTRACTION_ARTIFACT_SCHEMA_VERSION } from './artifact.js'
import { isSourceVerificationEvidence } from './evidence.js'
import { assertDeploymentIdentifier, type ExtractionProducerIdentity } from './producer.js'
import type {
  ExtractionArtifact,
  ExtractionWorkDecision,
  ExtractionWorkReason,
  SourceVerificationEvidence,
} from '../@types/extraction-types.js'

/**
 * The output and evidence a reference currently holds. Pass only this reference's
 * own record: reuse here means "keep what this reference has", not a cache lookup.
 * An artifact with a `null` `producerConfigHash` must never be returned as a cache
 * match for a fully identified producer or for another reference.
 *
 * @provisional
 */
export interface ExistingExtraction {
  state: 'complete' | 'failed' | 'identity-problem'
  artifact?: Pick<
    ExtractionArtifact,
    | 'contentHash'
    | 'sourceVerified'
    | 'provider'
    | 'providerVersion'
    | 'producerConfigHash'
    | 'schemaVersion'
  >
  evidence?: unknown
}

/**
 * Decides whether a reference needs extraction, before any bytes are read.
 *
 * - A reference with no `fileHash` is an identity problem. `force` does not bypass it.
 * - `force` always yields `work`. It bypasses reuse, never the verified read.
 * - `reuse` needs a complete, verified artifact for the reference's hash, valid
 *   evidence for that hash, the same provider and configuration, a version that
 *   passes the version rules, and the current schema. Follow it with
 *   `probeVerifiedSource`.
 * - A `null` current engine version never yields a version reason, so an unknown
 *   version cannot cause repeated work.
 * - An artifact with a `null` `producerConfigHash` is historical output whose
 *   configuration was never recorded. Only that hash and a `null` recorded version go
 *   uncompared, and `reuse` then reports `producerUnchecked: true`. A provider
 *   mismatch, two known versions that differ, and every other reason apply unchanged.
 *
 * The decision is synchronous and cannot recompute the hash, so it trusts that
 * `producer.deploymentIdentifier` is the value hashed into `producerConfigHash`.
 * `buildExtractionProducer` guarantees that. It checks the identifier's form and
 * throws a `TypeError` when malformed.
 *
 * Hosts may add their own reasons and treat the union as the decision.
 *
 * @provisional
 */
export function decideExtractionWork(input: {
  force?: boolean
  reference: { fileHash?: string | null }
  producer: ExtractionProducerIdentity
  existing?: ExistingExtraction | null
}): ExtractionWorkDecision {
  const { reference, producer, existing } = input
  if (producer.deploymentIdentifier !== null) {
    assertDeploymentIdentifier(producer.deploymentIdentifier)
  }

  const fileHash = reference.fileHash
  if (fileHash === undefined || fileHash === null || fileHash === '') {
    return { kind: 'identity-problem', problem: 'missing-hash' }
  }

  const versionUnchecked =
    producer.providerVersion === null && producer.deploymentIdentifier === null
  const reasons = new Set<ExtractionWorkReason>()
  if (input.force === true) reasons.add('force')

  const artifact = existing?.artifact
  if (existing?.state === 'failed' || existing?.state === 'identity-problem') {
    reasons.add('previous-attempt-unsuccessful')
  } else if (artifact === undefined) {
    reasons.add('no-artifact')
  }

  let evidence: SourceVerificationEvidence | undefined
  if (artifact !== undefined) {
    if (artifact.schemaVersion !== EXTRACTION_ARTIFACT_SCHEMA_VERSION) reasons.add('schema-changed')

    if (artifact.contentHash === null || !artifact.sourceVerified) {
      reasons.add('unverified')
    } else if (artifact.contentHash !== fileHash) {
      reasons.add('source-changed')
    } else if (isSourceVerificationEvidence(existing?.evidence, { expectedHash: fileHash })) {
      evidence = existing?.evidence as SourceVerificationEvidence
    } else {
      reasons.add('unverified')
    }

    if (producerChanged(artifact, producer)) reasons.add('producer-changed')
  }

  if (reasons.size > 0 || evidence === undefined || artifact === undefined) {
    return { kind: 'work', reasons: [...reasons], versionUnchecked }
  }
  return {
    kind: 'reuse',
    evidence,
    versionUnchecked,
    producerUnchecked: artifact.producerConfigHash === null,
  }
}

function producerChanged(
  artifact: NonNullable<ExistingExtraction['artifact']>,
  producer: ExtractionProducerIdentity
): boolean {
  if (artifact.provider !== producer.provider) return true

  const recordedConfiguration = artifact.producerConfigHash !== null
  if (recordedConfiguration && artifact.producerConfigHash !== producer.producerConfigHash) {
    return true
  }

  // A null current version never yields a reason, so it cannot cause repeated work.
  if (producer.providerVersion === null) return false
  if (artifact.providerVersion === null) {
    // Recorded before versions were known: work once, and the new artifact then
    // records the version. Historical output with no recorded configuration is
    // exempt, because adopting these contracts must not cause re-extraction.
    return recordedConfiguration
  }
  return artifact.providerVersion !== producer.providerVersion
}
