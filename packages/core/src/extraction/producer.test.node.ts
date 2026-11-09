/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_PATTERN, sha256Hex } from '../storage/content-hash.js'
import { buildExtractionProducer, producerConfigHash } from './producer.js'
import type { ExtractionProvider } from '../@types/extraction-types.js'

const encoder = new TextEncoder()

describe('producerConfigHash', () => {
  it('hashes the canonical JSON of its inputs as lower-case SHA-256', async () => {
    const hash = await producerConfigHash({
      provider: 'tika',
      configuration: { ocr: true, dpi: 300 },
      hints: { language: 'en', filename: 'a.pdf' },
      outputAffectingHints: ['language'],
      configurationVersion: 'v1',
      deploymentIdentifier: 'image-a',
    })

    const expected =
      '{"configuration":{"dpi":300,"ocr":true},"configurationVersion":"v1",' +
      '"deploymentIdentifier":"image-a","hints":{"language":"en"},"provider":"tika"}'
    expect(hash).toBe(await sha256Hex(encoder.encode(expected)))
    expect(hash).toMatch(CONTENT_HASH_PATTERN)
  })

  it('does not depend on key order at any depth', async () => {
    const a = await producerConfigHash({
      provider: 'p',
      configuration: { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } },
    })
    const b = await producerConfigHash({
      provider: 'p',
      configuration: { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 },
    })

    expect(a).toBe(b)
  })

  it('keeps array order significant', async () => {
    const a = await producerConfigHash({ provider: 'p', configuration: { langs: ['th', 'en'] } })
    const b = await producerConfigHash({ provider: 'p', configuration: { langs: ['en', 'th'] } })

    expect(a).not.toBe(b)
  })

  it('drops undefined object members', async () => {
    const a = await producerConfigHash({
      provider: 'p',
      configuration: { a: 1, b: undefined } as never,
    })
    const b = await producerConfigHash({ provider: 'p', configuration: { a: 1 } })

    expect(a).toBe(b)
  })

  it('drops nested undefined members, unlike strict JSON validation of artifact structure', async () => {
    const a = await producerConfigHash({
      provider: 'p',
      configuration: { section: { a: 1, b: undefined } } as never,
    })
    const b = await producerConfigHash({ provider: 'p', configuration: { section: { a: 1 } } })

    expect(a).toBe(b)
  })

  it('keeps only the output-affecting hints that were supplied', async () => {
    const withFilename = await producerConfigHash({
      provider: 'p',
      hints: { language: 'en', filename: 'a.pdf' },
      outputAffectingHints: ['language', 'ocrLanguages'],
    })
    const withoutFilename = await producerConfigHash({
      provider: 'p',
      hints: { language: 'en' },
      outputAffectingHints: ['language', 'ocrLanguages'],
    })
    const otherLanguage = await producerConfigHash({
      provider: 'p',
      hints: { language: 'th' },
      outputAffectingHints: ['language'],
    })

    expect(withFilename).toBe(withoutFilename)
    expect(otherLanguage).not.toBe(withoutFilename)
  })

  it('ignores every hint when the provider declares none', async () => {
    const a = await producerConfigHash({ provider: 'p', hints: { language: 'en' } })
    const b = await producerConfigHash({ provider: 'p' })

    expect(a).toBe(b)
  })

  it.each([
    ['provider', { provider: 'q' }],
    ['configuration', { provider: 'p', configuration: { a: 2 } }],
    ['configuration version', { provider: 'p', configurationVersion: 'v2' }],
    ['deployment identifier', { provider: 'p', deploymentIdentifier: 'image-b' }],
  ])('changes with the %s', async (_label, change) => {
    const inputs = {
      provider: 'p',
      configuration: { a: 1 },
      configurationVersion: 'v1',
      deploymentIdentifier: 'image-a',
    }

    const base = await producerConfigHash(inputs)
    const changed = await producerConfigHash({ ...inputs, ...change })

    expect(changed).not.toBe(base)
  })

  it('treats an absent and a null deployment identifier as the same', async () => {
    const absent = await producerConfigHash({ provider: 'p' })
    const nullIdentifier = await producerConfigHash({ provider: 'p', deploymentIdentifier: null })

    expect(nullIdentifier).toBe(absent)
  })

  it.each([
    ['empty', ''],
    ['leading whitespace', ' image'],
    ['trailing whitespace', 'image '],
    ['only whitespace', '   '],
    ['not a string', 7],
  ])('rejects a deployment identifier that is %s', async (_label, deploymentIdentifier) => {
    await expect(
      producerConfigHash({ provider: 'p', deploymentIdentifier: deploymentIdentifier as string })
    ).rejects.toThrow(TypeError)
  })

  it.each([
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a Date', new Date(0)],
    ['a class instance', new (class Thing {})()],
    ['undefined in an array', [undefined]],
  ])('rejects %s as a non-JSON value', async (_label, value) => {
    await expect(
      producerConfigHash({ provider: 'p', configuration: { value } as never })
    ).rejects.toThrow(TypeError)
  })

  it.each([
    ['one hole', () => new Array(1)],
    ['several holes', () => new Array(3)],
    [
      'a hole beside values',
      () => {
        const items = [1]
        items[2] = 2
        return items
      },
    ],
    ['a very long sparse array', () => new Array(2 ** 32 - 1)],
  ])('rejects a sparse array with %s', async (_label, items) => {
    await expect(
      producerConfigHash({ provider: 'p', configuration: { items: items() } as never })
    ).rejects.toThrow(TypeError)
  })

  it('rejects a nested sparse array', async () => {
    await expect(
      producerConfigHash({ provider: 'p', configuration: { a: { b: [new Array(1)] } } as never })
    ).rejects.toThrow(TypeError)
  })

  it('rejects a sparse output-affecting hint array', async () => {
    await expect(
      producerConfigHash({
        provider: 'p',
        hints: { ocrLanguages: new Array(1) },
        outputAffectingHints: ['ocrLanguages'],
      })
    ).rejects.toThrow(TypeError)
  })

  it('rejects symbol keys, which JSON would silently drop', async () => {
    await expect(
      producerConfigHash({ provider: 'p', configuration: { [Symbol('x')]: 1 } as never })
    ).rejects.toThrow(TypeError)
  })

  it('rejects a cycle rather than overflowing the stack', async () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle

    await expect(
      producerConfigHash({ provider: 'p', configuration: cycle as never })
    ).rejects.toThrow(TypeError)
  })

  it('accepts a shared object that is not a cycle', async () => {
    const shared = { x: 1 }

    await expect(
      producerConfigHash({ provider: 'p', configuration: { a: shared, b: shared } })
    ).resolves.toMatch(CONTENT_HASH_PATTERN)
  })
})

describe('buildExtractionProducer', () => {
  const provider: ExtractionProvider = {
    name: 'tika',
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
    configuration: { ocr: false },
    outputAffectingHints: ['language'],
    extract: () => Promise.reject(new Error('not used')),
  }

  it('returns the identifier it hashed, with the same hash as a direct call', async () => {
    const producer = await buildExtractionProducer({
      provider,
      providerVersion: '3.0.0',
      hints: { language: 'th', filename: 'a.pdf' },
      configurationVersion: 'v1',
      deploymentIdentifier: 'image-a',
    })

    expect(producer).toEqual({
      provider: 'tika',
      providerVersion: '3.0.0',
      deploymentIdentifier: 'image-a',
      producerConfigHash: await producerConfigHash({
        provider: 'tika',
        configuration: { ocr: false },
        hints: { language: 'th' },
        outputAffectingHints: ['language'],
        configurationVersion: 'v1',
        deploymentIdentifier: 'image-a',
      }),
    })
  })

  it('gives a different hash for a different identifier', async () => {
    const a = await buildExtractionProducer({
      provider,
      providerVersion: null,
      deploymentIdentifier: 'image-a',
    })
    const b = await buildExtractionProducer({
      provider,
      providerVersion: null,
      deploymentIdentifier: 'image-b',
    })

    expect(a.producerConfigHash).not.toBe(b.producerConfigHash)
  })

  it('normalises an absent identifier to null', async () => {
    const producer = await buildExtractionProducer({ provider, providerVersion: null })

    expect(producer.deploymentIdentifier).toBeNull()
    expect(producer.providerVersion).toBeNull()
  })

  it('does not put the engine version in the hash', async () => {
    const a = await buildExtractionProducer({ provider, providerVersion: '1.0.0' })
    const b = await buildExtractionProducer({ provider, providerVersion: '2.0.0' })

    expect(a.producerConfigHash).toBe(b.producerConfigHash)
  })

  it('rejects a malformed identifier', async () => {
    await expect(
      buildExtractionProducer({ provider, providerVersion: null, deploymentIdentifier: ' a' })
    ).rejects.toThrow(TypeError)
  })
})
