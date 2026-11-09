/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { type ExtractionArtifactIssueCode, validateExtractionArtifact } from './artifact.js'
import type { ExtractionArtifact } from '../@types/extraction-types.js'

const HASH = 'a'.repeat(64)
const CONFIG_HASH = 'b'.repeat(64)

function validArtifact(): ExtractionArtifact {
  return {
    schemaVersion: 1,
    contentHash: HASH,
    sourceVerified: true,
    provider: 'tika',
    providerVersion: '3.0.0',
    producerConfigHash: CONFIG_HASH,
    plainText: 'alpha',
    metadata: {},
    signals: { totalChars: 5 },
    producedAt: '2026-11-04T00:00:00.000Z',
  }
}

function codes(value: unknown, options?: { allowUnrecordedProducer?: boolean }) {
  const result = validateExtractionArtifact(value, options)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('validateExtractionArtifact', () => {
  it('accepts a complete artifact', () => {
    expect(validateExtractionArtifact(validArtifact())).toEqual({ ok: true })
  })

  it('accepts the optional members', () => {
    expect(
      validateExtractionArtifact({
        ...validArtifact(),
        providerVersion: null,
        markdown: '# alpha',
        structure: { any: ['json'] },
        pageCount: 1,
        pageMap: {
          version: 1,
          assembly: { pageSeparator: '' },
          pages: [{ index: 1, charStart: 0, charEnd: 5 }],
        },
      })
    ).toEqual({ ok: true })
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'artifact'],
  ])('rejects %s', (_label, value) => {
    expect(codes(value)).toContain('invalid-shape')
  })

  it('reports an unknown schema version as unsupported', () => {
    expect(codes({ ...validArtifact(), schemaVersion: 2 })).toEqual(['unsupported-schema-version'])
  })

  it.each<[string, Record<string, unknown>, ExtractionArtifactIssueCode]>([
    ['a short content hash', { contentHash: 'abc' }, 'invalid-content-hash'],
    ['an upper-case content hash', { contentHash: 'A'.repeat(64) }, 'invalid-content-hash'],
    ['an empty content hash', { contentHash: '' }, 'invalid-content-hash'],
    ['a malformed configuration hash', { producerConfigHash: 'x' }, 'invalid-producer-config-hash'],
    ['an empty provider', { provider: '' }, 'invalid-provider'],
    ['a numeric provider version', { providerVersion: 3 }, 'invalid-provider-version'],
    ['absent plain text', { plainText: undefined }, 'invalid-plain-text'],
    ['non-string markdown', { markdown: 1 }, 'invalid-markdown'],
    ['a negative page count', { pageCount: -1 }, 'invalid-page-count'],
    ['a fractional page count', { pageCount: 1.5 }, 'invalid-page-count'],
    ['absent metadata', { metadata: undefined }, 'invalid-metadata'],
    ['absent signals', { signals: undefined }, 'invalid-signals'],
    ['a negative total', { signals: { totalChars: -1 } }, 'invalid-signals'],
    ['a date without a time', { producedAt: '2026-11-04' }, 'invalid-produced-at'],
    ['an unparseable date', { producedAt: 'yesterday' }, 'invalid-produced-at'],
    ['a non-boolean verified flag', { sourceVerified: 'yes' }, 'source-verified-mismatch'],
  ])('rejects %s', (_label, change, code) => {
    expect(codes({ ...validArtifact(), ...change })).toContain(code)
  })

  it('requires sourceVerified to agree with contentHash', () => {
    expect(codes({ ...validArtifact(), sourceVerified: false })).toContain(
      'source-verified-mismatch'
    )
    expect(codes({ ...validArtifact(), contentHash: null })).toContain('source-verified-mismatch')
  })

  it('accepts a legacy import with no source identity', () => {
    expect(
      validateExtractionArtifact({ ...validArtifact(), contentHash: null, sourceVerified: false })
    ).toEqual({ ok: true })
  })

  it('reports page map issues against the artifact text and page count', () => {
    const artifact = {
      ...validArtifact(),
      pageCount: 2,
      pageMap: {
        version: 1,
        assembly: { pageSeparator: '' },
        pages: [{ index: 1, charStart: 0, charEnd: 5 }],
      },
    }

    expect(codes(artifact)).toContain('invalid-page-map')
  })

  describe('structure', () => {
    it('accepts any JSON value, because it is opaque to Byline', () => {
      for (const structure of [null, 1, 'text', true, [1, { a: [] }], { a: { b: null } }]) {
        expect(validateExtractionArtifact({ ...validArtifact(), structure })).toEqual({ ok: true })
      }
    })

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle

    it.each<[string, unknown]>([
      ['a bigint', 1n],
      ['a nested function', { a: () => 1 }],
      ['NaN', [Number.NaN]],
      ['a Date', new Date(0)],
      ['a sparse array', new Array(1)],
      ['an undefined member', { value: undefined }],
      ['a nested undefined member', { section: { value: undefined } }],
      ['an undefined member inside an array', [{ value: undefined }]],
      ['a cycle', cycle],
    ])('rejects %s', (_label, structure) => {
      expect(codes({ ...validArtifact(), structure })).toContain('invalid-structure')
    })
  })

  describe('metadata members', () => {
    it('accepts recognised members and ignores unknown ones', () => {
      expect(
        validateExtractionArtifact({
          ...validArtifact(),
          metadata: {
            contentType: 'application/pdf',
            pages: 3,
            title: 'T',
            authors: ['A', 'B'],
            language: 'en',
            createdAt: '2026-01-01T00:00:00Z',
            producer: 'P',
            somethingElse: { any: 1 },
          },
        })
      ).toEqual({ ok: true })
    })

    it.each<[string, Record<string, unknown>]>([
      ['non-string authors', { authors: 42 }],
      ['an author that is not a string', { authors: ['A', 1] }],
      ['a hole in authors', { authors: new Array(1) }],
      ['non-numeric pages', { pages: 'bad' }],
      ['negative pages', { pages: -1 }],
      ['a non-string title', { title: 1 }],
      ['a non-string content type', { contentType: 1 }],
      ['a non-string language', { language: 1 }],
      ['a non-string creation date', { createdAt: 1 }],
      ['a creation date that is not ISO 8601', { createdAt: 'not-a-date' }],
      ['a raw PDF creation date', { createdAt: "D:20260101000000+07'00'" }],
      ['a non-string producer', { producer: 1 }],
    ])('rejects %s', (_label, metadata) => {
      expect(codes({ ...validArtifact(), metadata })).toContain('invalid-metadata')
    })
  })

  describe('signals members', () => {
    it('accepts recognised members and ignores unknown ones', () => {
      expect(
        validateExtractionArtifact({
          ...validArtifact(),
          signals: {
            totalChars: 5,
            charsPerPage: [2, 3],
            ocrCandidatePages: 0,
            textLayerCoverage: 1,
            somethingElse: true,
          },
        })
      ).toEqual({ ok: true })
    })

    it.each<[string, Record<string, unknown>]>([
      ['non-array charsPerPage', { charsPerPage: 'bad' }],
      ['a negative page count in charsPerPage', { charsPerPage: [-1] }],
      ['a hole in charsPerPage', { charsPerPage: new Array(1) }],
      ['a fractional OCR candidate count', { ocrCandidatePages: 1.5 }],
      ['coverage above one', { textLayerCoverage: 2 }],
      ['coverage below zero', { textLayerCoverage: -0.1 }],
      ['non-numeric coverage', { textLayerCoverage: '1' }],
    ])('rejects %s', (_label, change) => {
      expect(codes({ ...validArtifact(), signals: { totalChars: 5, ...change } })).toContain(
        'invalid-signals'
      )
    })
  })

  describe('an unrecorded producer configuration', () => {
    const historical = { ...validArtifact(), providerVersion: null, producerConfigHash: null }

    it('is rejected by default, so a new extraction cannot record null', () => {
      expect(codes(historical)).toEqual(['unrecorded-producer'])
    })

    it('is rejected when the option is false', () => {
      expect(codes(historical, { allowUnrecordedProducer: false })).toEqual(['unrecorded-producer'])
    })

    it('is accepted when reading a historical record', () => {
      expect(validateExtractionArtifact(historical, { allowUnrecordedProducer: true })).toEqual({
        ok: true,
      })
    })

    it('does not relax a malformed configuration hash', () => {
      expect(
        codes({ ...validArtifact(), producerConfigHash: 'x' }, { allowUnrecordedProducer: true })
      ).toContain('invalid-producer-config-hash')
    })
  })
})
