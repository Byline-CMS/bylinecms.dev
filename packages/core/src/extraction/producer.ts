/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { sha256Hex } from '../storage/content-hash.js'
import { canonicalJson } from './internal.js'
import type {
  ExtractionHintName,
  ExtractionHints,
  ExtractionProvider,
} from '../@types/extraction-types.js'
import type { JsonValue } from '../@types/field-data-types.js'

/** An absent identifier and `null` mean the same: no identifier. */
function normaliseDeploymentIdentifier(identifier: unknown): string | null {
  if (identifier === undefined || identifier === null) return null
  assertDeploymentIdentifier(identifier)
  return identifier
}

/** A deployment identifier is a non-empty string with no surrounding whitespace. */
export function assertDeploymentIdentifier(identifier: unknown): asserts identifier is string {
  if (typeof identifier !== 'string' || identifier === '' || identifier !== identifier.trim()) {
    throw new TypeError(
      'deploymentIdentifier must be a non-empty string with no surrounding whitespace'
    )
  }
}

/**
 * SHA-256 of the canonical JSON of everything that decides a producer's output,
 * apart from the engine version. That version is recorded beside the hash as
 * `providerVersion`, so an engine change is visible as its own reuse reason. A
 * deployment identifier is what the host deployed rather than what the engine
 * reports, so it is hashed.
 *
 * Rejects a malformed deployment identifier or a non-JSON value with a `TypeError`.
 *
 * @provisional
 */
export async function producerConfigHash(input: {
  provider: string
  configuration?: Readonly<Record<string, JsonValue>>
  hints?: ExtractionHints
  /** Only these hints are kept; a provider that ignores a hint omits it. */
  outputAffectingHints?: readonly ExtractionHintName[]
  /** A host-chosen policy version. */
  configurationVersion?: string
  /** A host-controlled engine deployment identifier, such as a pinned image tag. */
  deploymentIdentifier?: string | null
}): Promise<string> {
  const hints: Record<string, unknown> = {}
  for (const name of input.outputAffectingHints ?? []) {
    if (input.hints?.[name] !== undefined) hints[name] = input.hints[name]
  }
  const canonical = canonicalJson({
    provider: input.provider,
    configuration: input.configuration,
    hints: Object.keys(hints).length > 0 ? hints : undefined,
    configurationVersion: input.configurationVersion,
    deploymentIdentifier: normaliseDeploymentIdentifier(input.deploymentIdentifier) ?? undefined,
  })
  return sha256Hex(new TextEncoder().encode(canonical))
}

/**
 * The producer of one run, built once so that its hash and the work decision come
 * from the same values.
 *
 * @provisional
 */
export interface ExtractionProducerIdentity {
  provider: string
  /** The current engine version, from `resolveVersion`, or `null`. */
  providerVersion: string | null
  /** Never `null`: a new extraction always records its real configuration. */
  producerConfigHash: string
  /** Exactly the value hashed into `producerConfigHash`. Never in `providerVersion`. */
  deploymentIdentifier: string | null
}

/**
 * The recommended way to obtain a producer. It keeps `deploymentIdentifier`
 * consistent with `producerConfigHash` by construction.
 *
 * @provisional
 */
export async function buildExtractionProducer(input: {
  provider: ExtractionProvider
  /** From `resolveVersion`, or `null`. Never copied from an artifact. */
  providerVersion: string | null
  hints?: ExtractionHints
  configurationVersion?: string
  deploymentIdentifier?: string | null
}): Promise<ExtractionProducerIdentity> {
  const deploymentIdentifier = normaliseDeploymentIdentifier(input.deploymentIdentifier)
  return {
    provider: input.provider.name,
    providerVersion: input.providerVersion,
    deploymentIdentifier,
    producerConfigHash: await producerConfigHash({
      provider: input.provider.name,
      ...(input.provider.configuration !== undefined && {
        configuration: input.provider.configuration,
      }),
      ...(input.hints !== undefined && { hints: input.hints }),
      ...(input.provider.outputAffectingHints !== undefined && {
        outputAffectingHints: input.provider.outputAffectingHints,
      }),
      ...(input.configurationVersion !== undefined && {
        configurationVersion: input.configurationVersion,
      }),
      deploymentIdentifier,
    }),
  }
}
