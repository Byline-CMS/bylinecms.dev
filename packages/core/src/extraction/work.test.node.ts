/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { buildExtractionProducer, type ExtractionProducerIdentity } from './producer.js'
import { decideExtractionWork, type ExistingExtraction } from './work.js'
import type { ExtractionProvider, ExtractionResult } from '../@types/extraction-types.js'

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'c'.repeat(64)
const CONFIG_HASH = 'b'.repeat(64)
const OTHER_CONFIG_HASH = 'd'.repeat(64)

const EVIDENCE = {
  expectedHash: HASH,
  contentHash: HASH,
  validator: { kind: 's3-etag', value: '"abc"' },
  verifiedAt: '2026-10-31T06:00:00.000Z',
}

function producer(change?: Partial<ExtractionProducerIdentity>): ExtractionProducerIdentity {
  return {
    provider: 'tika',
    providerVersion: '3.0.0',
    producerConfigHash: CONFIG_HASH,
    deploymentIdentifier: null,
    ...change,
  }
}

type ArtifactFields = NonNullable<ExistingExtraction['artifact']>

function existing(artifact?: Partial<ArtifactFields>): ExistingExtraction {
  return {
    state: 'complete',
    evidence: EVIDENCE,
    artifact: {
      contentHash: HASH,
      sourceVerified: true,
      provider: 'tika',
      providerVersion: '3.0.0',
      producerConfigHash: CONFIG_HASH,
      schemaVersion: 1,
      ...artifact,
    },
  }
}

const reference = { fileHash: HASH }

describe('decideExtractionWork', () => {
  describe('source identity', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty', ''],
    ])('reports a %s fileHash as an identity problem, not a work reason', (_label, fileHash) => {
      expect(
        decideExtractionWork({
          reference: { fileHash },
          producer: producer(),
          existing: existing(),
        })
      ).toEqual({ kind: 'identity-problem', problem: 'missing-hash' })
    })

    it('does not let force bypass a missing hash', () => {
      expect(
        decideExtractionWork({ force: true, reference: {}, producer: producer(), existing: null })
      ).toEqual({ kind: 'identity-problem', problem: 'missing-hash' })
    })
  })

  describe('reuse', () => {
    it('reuses a complete, verified artifact for the same producer', () => {
      expect(
        decideExtractionWork({ reference, producer: producer(), existing: existing() })
      ).toEqual({
        kind: 'reuse',
        evidence: EVIDENCE,
        versionUnchecked: false,
        producerUnchecked: false,
      })
    })
  })

  describe('reasons', () => {
    it.each([
      ['no existing record', null, ['no-artifact']],
      ['an undefined record', undefined, ['no-artifact']],
      ['a complete record with no artifact', { state: 'complete' as const }, ['no-artifact']],
      ['a failed attempt', { state: 'failed' as const }, ['previous-attempt-unsuccessful']],
      [
        'an identity problem',
        { state: 'identity-problem' as const },
        ['previous-attempt-unsuccessful'],
      ],
      [
        'a failed attempt over a usable artifact',
        { ...existing(), state: 'failed' as const },
        ['previous-attempt-unsuccessful'],
      ],
      ['a different source', existing({ contentHash: OTHER_HASH }), ['source-changed']],
      ['an unverified artifact', existing({ sourceVerified: false }), ['unverified']],
      ['a legacy artifact', existing({ contentHash: null, sourceVerified: false }), ['unverified']],
      ['missing evidence', { ...existing(), evidence: undefined }, ['unverified']],
      ['copied-only evidence', { ...existing(), evidence: { expectedHash: HASH } }, ['unverified']],
      [
        'evidence for another hash',
        {
          ...existing(),
          evidence: { ...EVIDENCE, expectedHash: OTHER_HASH, contentHash: OTHER_HASH },
        },
        ['unverified'],
      ],
      ['a different provider', existing({ provider: 'docling' }), ['producer-changed']],
      [
        'a different configuration',
        existing({ producerConfigHash: OTHER_CONFIG_HASH }),
        ['producer-changed'],
      ],
      ['an unknown schema version', existing({ schemaVersion: 2 as 1 }), ['schema-changed']],
    ])('reports %s', (_label, record, reasons) => {
      expect(decideExtractionWork({ reference, producer: producer(), existing: record })).toEqual({
        kind: 'work',
        reasons,
        versionUnchecked: false,
      })
    })

    it('reports several reasons once each', () => {
      const decision = decideExtractionWork({
        reference,
        producer: producer(),
        existing: existing({
          provider: 'docling',
          producerConfigHash: OTHER_CONFIG_HASH,
          schemaVersion: 2 as 1,
        }),
      })

      expect(decision).toEqual({
        kind: 'work',
        reasons: ['schema-changed', 'producer-changed'],
        versionUnchecked: false,
      })
    })

    it('does not add unverified for evidence of a source that changed anyway', () => {
      const decision = decideExtractionWork({
        reference: { fileHash: OTHER_HASH },
        producer: producer(),
        existing: existing(),
      })

      expect(decision).toEqual({
        kind: 'work',
        reasons: ['source-changed'],
        versionUnchecked: false,
      })
    })
  })

  describe('force', () => {
    it('yields work on reuse-eligible input', () => {
      expect(
        decideExtractionWork({ force: true, reference, producer: producer(), existing: existing() })
      ).toEqual({ kind: 'work', reasons: ['force'], versionUnchecked: false })
    })

    it('is reported with any other reasons', () => {
      expect(
        decideExtractionWork({ force: true, reference, producer: producer(), existing: null })
      ).toEqual({ kind: 'work', reasons: ['force', 'no-artifact'], versionUnchecked: false })
    })
  })

  describe('engine version', () => {
    it('reuses when the known versions are equal', () => {
      expect(
        decideExtractionWork({ reference, producer: producer(), existing: existing() }).kind
      ).toBe('reuse')
    })

    it('reports producer-changed when the known versions differ', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ providerVersion: '4.0.0' }),
          existing: existing(),
        })
      ).toEqual({ kind: 'work', reasons: ['producer-changed'], versionUnchecked: false })
    })

    it('reports producer-changed when a recorded hash has a null version and the current is known', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer(),
          existing: existing({ providerVersion: null }),
        })
      ).toEqual({ kind: 'work', reasons: ['producer-changed'], versionUnchecked: false })
    })

    it.each([
      ['a recorded version', '3.0.0'],
      ['no recorded version', null],
    ])('gives no version reason with an unknown current version and %s', (_label, version) => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ providerVersion: null }),
          existing: existing({ providerVersion: version }),
        })
      ).toEqual({
        kind: 'reuse',
        evidence: EVIDENCE,
        versionUnchecked: true,
        producerUnchecked: false,
      })
    })

    it('reports versionUnchecked false when a deployment identifier is configured', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ providerVersion: null, deploymentIdentifier: 'image-a' }),
          existing: existing({ providerVersion: null }),
        })
      ).toEqual({
        kind: 'reuse',
        evidence: EVIDENCE,
        versionUnchecked: false,
        producerUnchecked: false,
      })
    })

    it('reports versionUnchecked on work too', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ providerVersion: null }),
          existing: null,
        })
      ).toEqual({ kind: 'work', reasons: ['no-artifact'], versionUnchecked: true })
    })
  })

  describe('deployment identifier form', () => {
    it.each([
      ['empty', ''],
      ['untrimmed', ' image'],
      ['not a string', 7],
    ])('rejects an identifier that is %s', (_label, deploymentIdentifier) => {
      expect(() =>
        decideExtractionWork({
          reference,
          producer: producer({ deploymentIdentifier: deploymentIdentifier as string }),
        })
      ).toThrow(TypeError)
    })
  })

  describe('historical output with no recorded producer', () => {
    const historical = () => existing({ providerVersion: null, producerConfigHash: null })

    it.each([
      ['a known current version', '3.0.0', false],
      ['an unknown current version', null, true],
    ])('reuses without work, with %s', (_label, providerVersion, versionUnchecked) => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ providerVersion }),
          existing: historical(),
        })
      ).toEqual({
        kind: 'reuse',
        evidence: EVIDENCE,
        versionUnchecked,
        producerUnchecked: true,
      })
    })

    it('does not detect a changed deployment identifier', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ deploymentIdentifier: 'image-b' }),
          existing: historical(),
        })
      ).toMatchObject({ kind: 'reuse', producerUnchecked: true })
    })

    it('still compares a recorded version with a known current one', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer({ providerVersion: '4.0.0' }),
          existing: existing({ providerVersion: '3.0.0', producerConfigHash: null }),
        })
      ).toEqual({ kind: 'work', reasons: ['producer-changed'], versionUnchecked: false })
    })

    it('reuses when a recorded version equals the known current one', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer(),
          existing: existing({ providerVersion: '3.0.0', producerConfigHash: null }),
        })
      ).toMatchObject({ kind: 'reuse', producerUnchecked: true })
    })

    it.each([
      ['a provider mismatch', { provider: 'docling' }, 'producer-changed'],
      ['a changed source hash', { contentHash: OTHER_HASH }, 'source-changed'],
      ['an unverified artifact', { sourceVerified: false }, 'unverified'],
      ['a legacy artifact', { contentHash: null, sourceVerified: false }, 'unverified'],
      ['a different schema', { schemaVersion: 2 as 1 }, 'schema-changed'],
    ])('still reports %s', (_label, change, reason) => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer(),
          existing: existing({ providerVersion: null, producerConfigHash: null, ...change }),
        })
      ).toEqual({ kind: 'work', reasons: [reason], versionUnchecked: false })
    })

    it('still requires evidence', () => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer(),
          existing: { ...historical(), evidence: undefined },
        })
      ).toEqual({ kind: 'work', reasons: ['unverified'], versionUnchecked: false })
    })

    it.each(['failed', 'identity-problem'] as const)('still retries a %s state', (state) => {
      expect(
        decideExtractionWork({
          reference,
          producer: producer(),
          existing: { ...historical(), state },
        })
      ).toEqual({
        kind: 'work',
        reasons: ['previous-attempt-unsuccessful'],
        versionUnchecked: false,
      })
    })

    it('still honours force', () => {
      expect(
        decideExtractionWork({
          force: true,
          reference,
          producer: producer(),
          existing: historical(),
        })
      ).toEqual({ kind: 'work', reasons: ['force'], versionUnchecked: false })
    })

    it('never reports producerUnchecked for a recorded configuration', () => {
      const decision = decideExtractionWork({
        reference,
        producer: producer({ providerVersion: null }),
        existing: existing({ providerVersion: null }),
      })

      expect(decision).toMatchObject({ kind: 'reuse', producerUnchecked: false })
    })
  })

  describe('successive runs', () => {
    // A small orchestration loop over the real helpers: each run decides, and work
    // records an artifact the way the specification requires.
    function createHarness(options: {
      engineVersion: () => string | undefined
      resolveVersion?: () => Promise<string>
    }) {
      const provider: ExtractionProvider = {
        name: 'fake',
        capabilities: {
          ocr: false,
          markdown: false,
          tables: false,
          formulas: false,
          charts: false,
          coordinates: false,
          pageMap: false,
          structure: false,
          formats: ['*/*'],
        },
        ...(options.resolveVersion != null && { resolveVersion: options.resolveVersion }),
        extract: async (): Promise<ExtractionResult> => {
          const version = options.engineVersion()
          return {
            provider: 'fake',
            ...(version != null && { providerVersion: version }),
            plainText: 'text',
            metadata: {},
            signals: { totalChars: 4 },
          }
        },
      }
      let record: ExistingExtraction | null = null
      let extractions = 0

      return {
        get extractions() {
          return extractions
        },
        async run(deploymentIdentifier: string | null) {
          const resolved = (await provider.resolveVersion?.()) ?? null
          const current = await buildExtractionProducer({
            provider,
            providerVersion: resolved,
            deploymentIdentifier,
          })
          const decision = decideExtractionWork({ reference, producer: current, existing: record })
          if (decision.kind === 'work') {
            extractions += 1
            const result = await provider.extract({ data: new Uint8Array() })
            record = {
              state: 'complete',
              evidence: EVIDENCE,
              artifact: {
                contentHash: HASH,
                sourceVerified: true,
                provider: result.provider,
                // The result's own version wins, then the version resolved for the run.
                providerVersion: result.providerVersion ?? resolved,
                producerConfigHash: current.producerConfigHash,
                schemaVersion: 1,
              },
            }
          }
          return decision
        },
      }
    }

    it('re-extracts once when a configured deployment identifier changes', async () => {
      const harness = createHarness({ engineVersion: () => undefined })

      const run1 = await harness.run('A')
      const run2 = await harness.run('A')
      const run3 = await harness.run('B')
      const run4 = await harness.run('B')

      expect(run1).toMatchObject({ kind: 'work', reasons: ['no-artifact'] })
      expect(run2).toMatchObject({ kind: 'reuse', versionUnchecked: false })
      expect(run3).toMatchObject({ kind: 'work', reasons: ['producer-changed'] })
      expect(run4).toMatchObject({ kind: 'reuse', versionUnchecked: false })
      expect(harness.extractions).toBe(2)
    })

    it('records the resolved version when the result reports none, then reuses', async () => {
      const harness = createHarness({
        engineVersion: () => undefined,
        resolveVersion: async () => '3.0.0',
      })

      expect(await harness.run(null)).toMatchObject({ kind: 'work' })
      expect(await harness.run(null)).toMatchObject({ kind: 'reuse', versionUnchecked: false })
      expect(harness.extractions).toBe(1)
    })

    it('records the result version after a mid-run upgrade, then reuses', async () => {
      let resolved = '3.0.0'
      const harness = createHarness({
        // The engine was upgraded while the first run was in progress.
        engineVersion: () => '4.0.0',
        resolveVersion: async () => resolved,
      })

      expect(await harness.run(null)).toMatchObject({ kind: 'work' })
      resolved = '4.0.0'
      expect(await harness.run(null)).toMatchObject({ kind: 'reuse' })
      expect(harness.extractions).toBe(1)
    })

    it('never repeats work for a driver with no version and no identifier', async () => {
      const harness = createHarness({ engineVersion: () => undefined })

      await harness.run(null)
      expect(await harness.run(null)).toMatchObject({ kind: 'reuse', versionUnchecked: true })
      expect(await harness.run(null)).toMatchObject({ kind: 'reuse', versionUnchecked: true })
      expect(harness.extractions).toBe(1)
    })
  })
})
