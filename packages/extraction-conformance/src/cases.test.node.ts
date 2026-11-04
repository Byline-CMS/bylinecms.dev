/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  ExtractorCapabilities,
} from '@byline/core'
import { ExtractionProviderError } from '@byline/core'
import { describe, expect, it } from 'vitest'

import {
  ConformanceFailure,
  type ConformanceHooks,
  extractionProviderConformanceCases,
  loadFixtures,
  SENTINELS,
} from './cases.js'

const fixtures = loadFixtures()

async function toBytes(data: ExtractionInput['data']): Promise<Buffer> {
  if (data instanceof Uint8Array) return Buffer.from(data)
  const chunks: Uint8Array[] = []
  for await (const chunk of data as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const fileFailure = (message: string) =>
  new ExtractionProviderError(message, { failureScope: 'file', retryable: false })
const infrastructureFailure = (message: string) =>
  new ExtractionProviderError(message, { failureScope: 'infrastructure', retryable: true })

const SEPARATOR = '\n\n'
const PAGE_TEXT = SENTINELS.join(SEPARATOR)

function pageMapOf(pages: readonly string[]) {
  let offset = 0
  return {
    version: 1 as const,
    assembly: { pageSeparator: SEPARATOR },
    pages: pages.map((text, i) => {
      const range = { index: i + 1, charStart: offset, charEnd: offset + text.length }
      offset += text.length + SEPARATOR.length
      return range
    }),
  }
}

const BASE_CAPABILITIES: ExtractorCapabilities = {
  ocr: false,
  markdown: true,
  tables: false,
  formulas: false,
  charts: false,
  coordinates: false,
  pageMap: true,
  structure: true,
  formats: ['application/pdf'],
}

/** An honest provider. A change replaces one part of its behaviour. */
function honestProvider(
  change: {
    capabilities?: Partial<ExtractorCapabilities>
    result?: (result: ExtractionResult) => ExtractionResult
    onInput?: (bytes: Buffer, input: ExtractionInput) => void
    extract?: ExtractionProvider['extract']
    ping?: ExtractionProvider['ping']
    resolveVersion?: ExtractionProvider['resolveVersion']
    name?: string
  } = {}
): ExtractionProvider {
  const capabilities = { ...BASE_CAPABILITIES, ...change.capabilities }
  const provider: ExtractionProvider = {
    name: change.name ?? 'honest',
    capabilities,
    extract:
      change.extract ??
      (async (input) => {
        input.signal?.throwIfAborted()
        const bytes = await toBytes(input.data)
        const accepted = capabilities.formats.some(
          (format) =>
            format === '*/*' ||
            format === input.mimeType ||
            (format.endsWith('/*') && input.mimeType?.startsWith(format.slice(0, -1)))
        )
        if (!accepted) throw fileFailure('unsupported format')
        if (bytes.equals(fixtures.corrupt)) throw fileFailure('corrupt')
        if (bytes.equals(fixtures.truncated)) throw fileFailure('truncated')
        change.onInput?.(bytes, input)
        const result: ExtractionResult = {
          provider: 'honest',
          providerVersion: '1.0.0',
          plainText: PAGE_TEXT,
          pageCount: 3,
          metadata: { contentType: 'application/pdf', pages: 3 },
          signals: { totalChars: PAGE_TEXT.length },
          ...(capabilities.markdown && { markdown: `# ${PAGE_TEXT}` }),
          ...(capabilities.structure && { structure: { blocks: [] } }),
          ...(capabilities.pageMap && { pageMap: pageMapOf(SENTINELS) }),
        }
        return change.result?.(result) ?? result
      }),
  }
  provider.resolveVersion = change.resolveVersion ?? (async () => '1.0.0')
  if (change.ping !== undefined) provider.ping = change.ping
  return provider
}

const unavailableProvider = (change: Partial<ExtractionProvider> = {}): ExtractionProvider => ({
  name: 'honest',
  capabilities: BASE_CAPABILITIES,
  extract: () => Promise.reject(infrastructureFailure('connection refused')),
  ping: () => Promise.reject(infrastructureFailure('connection refused')),
  ...change,
})

function hooks(change: Partial<ConformanceHooks> & { provider?: ExtractionProvider }) {
  const provider = change.provider ?? honestProvider()
  return {
    name: 'fake',
    createProvider: () => provider,
    createUnavailableProvider: () => unavailableProvider(),
    ...change,
  } satisfies ConformanceHooks
}

const caseById = (id: number) => {
  const found = extractionProviderConformanceCases.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no case ${id}`)
  return found
}

async function expectCaseFails(id: number, provider: ExtractionProvider, pattern: RegExp) {
  const error = await caseById(id)
    .run(hooks({ provider }), fixtures)
    .then(
      () => null,
      (err: unknown) => err
    )
  expect(error).toBeInstanceOf(ConformanceFailure)
  expect((error as Error).message).toMatch(pattern)
}

describe('fixtures', () => {
  it('match the output of the committed generator', () => {
    const output = mkdtempSync(join(tmpdir(), 'byline-extraction-fixtures-'))
    try {
      const script = fileURLToPath(new URL('../scripts/generate-fixtures.mjs', import.meta.url))
      execFileSync(process.execPath, [script, output])
      const committed = fileURLToPath(new URL('../fixtures/', import.meta.url))

      expect(readdirSync(committed).sort()).toEqual(readdirSync(output).sort())
      for (const name of readdirSync(output)) {
        expect(readFileSync(join(committed, name)).equals(readFileSync(join(output, name)))).toBe(
          true
        )
      }
    } finally {
      rmSync(output, { recursive: true, force: true })
    }
  })

  it('hold one sentinel per page in the sentinel file', () => {
    const text = fixtures.sentinel.toString('latin1')

    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
    for (const sentinel of SENTINELS) expect(text).toContain(`(${sentinel})`)
  })

  it('write a correct cross-reference table', () => {
    const text = fixtures.sentinel.toString('latin1')
    const start = Number(/startxref\n(\d+)\n/.exec(text)?.[1])
    const entries = text.slice(start).split('\n').slice(3, 12)

    expect(text.slice(start, start + 4)).toBe('xref')
    entries.forEach((entry, i) => {
      expect(text.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true)
    })
  })

  it('truncate the sentinel file before its table', () => {
    expect(
      fixtures.sentinel.subarray(0, fixtures.truncated.length).equals(fixtures.truncated)
    ).toBe(true)
    expect(fixtures.truncated.toString('latin1')).not.toContain('startxref')
  })

  it('leave the corrupt file with a header and no PDF objects', () => {
    const text = fixtures.corrupt.toString('latin1')

    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text).not.toContain(' obj')
    expect(text).not.toContain('xref')
  })
})

describe('the published package', () => {
  it('ships the fixture generator beside its fixtures, without the tests', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
    ) as { files: string[] }

    expect(manifest.files).toEqual(
      expect.arrayContaining(['dist', 'fixtures', 'scripts/generate-fixtures.mjs'])
    )
    expect(manifest.files).toContain('!dist/**/*.test.node.*')
  })
})

describe('an honest provider', () => {
  it.each(
    extractionProviderConformanceCases.map((entry) => [entry.id, entry.name, entry] as const)
  )('passes case %i: %s', async (_id, _name, entry) => {
    await expect(entry.run(hooks({}), fixtures)).resolves.toBeUndefined()
  })

  it('passes every case when it recovers a truncated file', async () => {
    const recovering = honestProvider()
    const extract = recovering.extract.bind(recovering)
    recovering.extract = async (input) => {
      const bytes = await toBytes(input.data)
      return extract({
        ...input,
        data: bytes.equals(fixtures.truncated) ? fixtures.sentinel : bytes,
      })
    }

    for (const entry of extractionProviderConformanceCases) {
      await expect(entry.run(hooks({ provider: recovering }), fixtures)).resolves.toBeUndefined()
    }
  })

  it('passes with the simplest capabilities, skipping what it does not claim', async () => {
    const simple = honestProvider({
      capabilities: { markdown: false, structure: false, pageMap: false },
    })
    delete simple.resolveVersion

    await expect(caseById(1).run(hooks({ provider: simple }), fixtures)).resolves.toBeUndefined()
    await expect(caseById(4).run(hooks({ provider: simple }), fixtures)).resolves.toEqual({
      skipped: expect.stringMatching(/pageMap/),
    })
    await expect(caseById(9).run(hooks({ provider: simple }), fixtures)).resolves.toEqual({
      skipped: expect.stringMatching(/resolveVersion/),
    })
  })

  it('skips the unavailable case without a hook', async () => {
    const { createUnavailableProvider: _omitted, ...withoutHook } = hooks({})

    await expect(caseById(6).run(withoutHook, fixtures)).resolves.toEqual({
      skipped: expect.stringMatching(/createUnavailableProvider/),
    })
  })

  it('skips the PDF cases for a provider that does not accept PDFs', async () => {
    const htmlOnly = honestProvider({ capabilities: { formats: ['text/html'] } })

    for (const id of [2, 3, 4, 8, 9]) {
      await expect(caseById(id).run(hooks({ provider: htmlOnly }), fixtures)).resolves.toEqual({
        skipped: expect.stringMatching(/application\/pdf/),
      })
    }
  })
})

describe('case 1: capability honesty', () => {
  it.each<[string, Partial<ExtractorCapabilities>, RegExp]>([
    ['empty formats', { formats: [] }, /formats/],
    ['a malformed format', { formats: ['pdf'] }, /formats/],
    ['a non-boolean capability', { ocr: 'yes' as never }, /ocr/],
  ])('fails %s', async (_label, capabilities, pattern) => {
    await expectCaseFails(1, honestProvider({ capabilities }), pattern)
  })

  it.each<[string, () => string[]]>([
    ['only holes', () => new Array(1)],
    [
      'a hole beside a valid format',
      () => {
        const formats = ['application/pdf']
        formats[2] = 'text/html'
        return formats
      },
    ],
    ['a very long sparse list', () => new Array(2 ** 32 - 1)],
  ])('fails formats with %s', async (_label, formats) => {
    await expectCaseFails(1, honestProvider({ capabilities: { formats: formats() } }), /formats/)
  })

  it('fails a missing capability', async () => {
    const provider = honestProvider()
    const { pageMap: _removed, ...capabilities } = provider.capabilities
    await expectCaseFails(1, { ...provider, capabilities: capabilities as never }, /pageMap/)
  })

  it.each<[string, Partial<ExtractorCapabilities>, (r: ExtractionResult) => ExtractionResult]>([
    [
      'markdown emitted with markdown: false',
      { markdown: false },
      (result) => ({ ...result, markdown: '# text' }),
    ],
    [
      'structure emitted with structure: false',
      { structure: false },
      (result) => ({ ...result, structure: {} }),
    ],
    [
      'a page map emitted with pageMap: false',
      { pageMap: false },
      (result) => ({ ...result, pageMap: pageMapOf(SENTINELS) }),
    ],
  ])('fails %s', async (_label, capabilities, result) => {
    await expectCaseFails(1, honestProvider({ capabilities, result }), /capabilit/)
  })

  it.each<[string, (r: ExtractionResult) => ExtractionResult]>([
    ['markdown claimed and absent', ({ markdown: _removed, ...result }) => result],
    ['structure claimed and absent', ({ structure: _removed, ...result }) => result],
    ['a page map claimed and absent', ({ pageMap: _removed, ...result }) => result],
  ])('fails %s', async (_label, result) => {
    await expectCaseFails(1, honestProvider({ result }), /capabilit/)
  })
})

describe('case 2: result shape', () => {
  it.each<[string, (r: ExtractionResult) => ExtractionResult, RegExp]>([
    ['a different provider name', (r) => ({ ...r, provider: 'other' }), /provider/],
    ['non-string plain text', (r) => ({ ...r, plainText: 1 as never }), /plainText/],
    ['a negative page count', (r) => ({ ...r, pageCount: -1 }), /pageCount/],
    ['malformed metadata', (r) => ({ ...r, metadata: { pages: 'x' as never } }), /metadata/],
    ['malformed signals', (r) => ({ ...r, signals: { totalChars: -1 } }), /signals/],
    ['an empty provider version', (r) => ({ ...r, providerVersion: '' }), /providerVersion/],
  ])('fails %s', async (_label, result, pattern) => {
    await expectCaseFails(2, honestProvider({ result }), pattern)
  })
})

describe('case 2: the full structural shape', () => {
  it('fails a correct page map beside a page count that disagrees with it', async () => {
    await expectCaseFails(2, honestProvider({ result: (r) => ({ ...r, pageCount: 2 }) }), /pageMap/)
  })

  it('fails a structurally invalid page map', async () => {
    await expectCaseFails(
      2,
      honestProvider({
        result: (r) => ({ ...r, pageMap: { ...pageMapOf(SENTINELS), version: 99 as 1 } }),
      }),
      /pageMap/
    )
  })
})

describe('case 3: sentinel text', () => {
  it('fails a result missing a sentinel', async () => {
    await expectCaseFails(
      3,
      honestProvider({
        result: (r) => ({ ...r, plainText: r.plainText.replace(SENTINELS[2], '') }),
      }),
      /BYLINE-SENTINEL-PAGE-3/
    )
  })
})

describe('case 4: page map sentinel verification', () => {
  it('fails a page map with a shifted page, although it is structurally valid', async () => {
    // Pages 1 and 2 hold each other's sentinels: complete coverage, wrong provenance.
    const shifted = [SENTINELS[1], SENTINELS[0], SENTINELS[2]]

    await expectCaseFails(
      4,
      honestProvider({
        result: (r) => ({ ...r, plainText: shifted.join(SEPARATOR), pageMap: pageMapOf(shifted) }),
      }),
      /page 1/
    )
  })

  it('fails a structurally invalid map', async () => {
    await expectCaseFails(
      4,
      honestProvider({
        result: (r) => ({ ...r, pageMap: { ...pageMapOf(SENTINELS), version: 2 as 1 } }),
      }),
      /validatePageMap/
    )
  })

  it('fails a map with the wrong number of pages', async () => {
    await expectCaseFails(
      4,
      honestProvider({
        result: (r) => ({
          ...r,
          plainText: SENTINELS[0],
          pageMap: pageMapOf([SENTINELS[0]]),
        }),
      }),
      /validatePageMap/
    )
  })

  it('fails a sentinel that lies in no page', async () => {
    const plainText = `${SENTINELS[0]}\n\n\n\n${SENTINELS[2]}\n\n${SENTINELS[1]}`
    const first = SENTINELS[0].length
    const third = first + 4 + SENTINELS[2].length
    await expectCaseFails(
      4,
      honestProvider({
        result: (r) => ({
          ...r,
          plainText,
          pageMap: {
            version: 1,
            assembly: { pageSeparator: SEPARATOR, trailing: 'embedded' },
            pages: [
              { index: 1, charStart: 0, charEnd: first },
              { index: 2, charStart: first + 2, charEnd: first + 2 },
              { index: 3, charStart: first + 4, charEnd: third },
            ],
            unanchored: [{ kind: 'embedded', charStart: third + 2, charEnd: plainText.length }],
          },
        }),
      }),
      /page 2/
    )
  })
})

describe('case 5: typed file failure', () => {
  function failingFor(fixture: Buffer, rejection: () => unknown): ExtractionProvider {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    return {
      ...provider,
      extract: async (input) => {
        const bytes = await toBytes(input.data)
        if (bytes.equals(fixture)) throw rejection()
        return extract({ ...input, data: bytes })
      },
    }
  }

  it('fails an untyped error for the truncated file', async () => {
    await expectCaseFails(
      5,
      failingFor(fixtures.truncated, () => new Error('boom')),
      /truncated/
    )
  })

  it('fails an infrastructure error for the truncated file', async () => {
    await expectCaseFails(
      5,
      failingFor(fixtures.truncated, () => infrastructureFailure('down')),
      /truncated/
    )
  })

  it('fails an untyped error for the corrupt file', async () => {
    await expectCaseFails(
      5,
      failingFor(fixtures.corrupt, () => new Error('boom')),
      /corrupt/
    )
  })

  it('fails a corrupt file that resolves', async () => {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    await expectCaseFails(
      5,
      {
        ...provider,
        extract: async (input) => {
          const bytes = await toBytes(input.data)
          return extract({
            ...input,
            data: bytes.equals(fixtures.corrupt) ? fixtures.sentinel : bytes,
          })
        },
      },
      /corrupt/
    )
  })

  it('fails a recovered truncated result with a malformed shape', async () => {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    await expectCaseFails(
      5,
      {
        ...provider,
        extract: async (input) => {
          const bytes = await toBytes(input.data)
          if (!bytes.equals(fixtures.truncated)) return extract({ ...input, data: bytes })
          return {
            ...(await extract({ ...input, data: fixtures.sentinel })),
            plainText: 1 as never,
          }
        },
      },
      /truncated/
    )
  })

  it('fails a recovered truncated result with an invalid page map', async () => {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    await expectCaseFails(
      5,
      {
        ...provider,
        extract: async (input) => {
          const bytes = await toBytes(input.data)
          if (!bytes.equals(fixtures.truncated)) return extract({ ...input, data: bytes })
          const recovered = await extract({ ...input, data: fixtures.sentinel })
          return { ...recovered, pageMap: { ...pageMapOf([]), version: 99 as 1 } }
        },
      },
      /truncated/
    )
  })

  it('fails an unsupported type that resolves for a non-wildcard list', async () => {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    await expectCaseFails(
      5,
      {
        ...provider,
        extract: (input) => extract({ ...input, mimeType: 'application/pdf' }),
      },
      /format/
    )
  })

  it('does not test unsupported types for a wildcard list', async () => {
    const provider = honestProvider({ capabilities: { formats: ['*/*'] } })

    await expect(caseById(5).run(hooks({ provider }), fixtures)).resolves.toBeUndefined()
  })
})

describe('case 6: typed infrastructure failure', () => {
  const withUnavailable = (provider: ExtractionProvider) =>
    caseById(6).run(hooks({ createUnavailableProvider: () => provider }), fixtures)

  it('fails an infrastructure error typed as file', async () => {
    await expect(
      withUnavailable(
        unavailableProvider({ extract: () => Promise.reject(fileFailure('misclassified')) })
      )
    ).rejects.toThrow(/infrastructure/)
  })

  it('fails an untyped error', async () => {
    await expect(
      withUnavailable(unavailableProvider({ extract: () => Promise.reject(new Error('refused')) }))
    ).rejects.toThrow(/infrastructure/)
  })

  it('fails an extract that resolves', async () => {
    await expect(withUnavailable(honestProvider())).rejects.toThrow(/infrastructure/)
  })

  it('fails a ping that resolves', async () => {
    await expect(
      withUnavailable(unavailableProvider({ ping: () => Promise.resolve() }))
    ).rejects.toThrow(/ping/)
  })

  it('accepts an unavailable provider with no ping', async () => {
    const { ping: _removed, ...noPing } = unavailableProvider()

    await expect(withUnavailable(noPing)).resolves.toBeUndefined()
  })
})

describe('case 7: abort', () => {
  it('fails an abort that resolves', async () => {
    await expectCaseFails(
      7,
      honestProvider({
        extract: async () => ({
          provider: 'honest',
          plainText: '',
          metadata: {},
          signals: { totalChars: 0 },
        }),
      }),
      /abort/i
    )
  })

  it('fails an abort classified as a file failure', async () => {
    await expectCaseFails(
      7,
      honestProvider({
        extract: (input) =>
          Promise.reject(input.signal?.aborted ? fileFailure('aborted') : new Error('no signal')),
      }),
      /file failure/
    )
  })

  it('accepts an untyped abort rejection', async () => {
    const provider = honestProvider({
      extract: (input) => Promise.reject(input.signal?.reason),
    })

    await expect(caseById(7).run(hooks({ provider }), fixtures)).resolves.toBeUndefined()
  })
})

describe('case 8: input forms', () => {
  it('fails different text for a stream', async () => {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    await expectCaseFails(
      8,
      {
        ...provider,
        extract: async (input) => {
          const result = await extract(input)
          return input.data instanceof Uint8Array ? result : { ...result, plainText: 'other' }
        },
      },
      /stream/i
    )
  })

  it('fails a provider that cannot read a stream', async () => {
    const provider = honestProvider()
    const extract = provider.extract.bind(provider)
    await expectCaseFails(
      8,
      {
        ...provider,
        extract: async (input) => {
          if (!(input.data instanceof Uint8Array)) throw new Error('no streams')
          return extract(input)
        },
      },
      /no streams/
    )
  })

  it('gives each form the fixture bytes', async () => {
    const seen: Buffer[] = []
    const provider = honestProvider({ onInput: (bytes) => seen.push(bytes) })

    await caseById(8).run(hooks({ provider }), fixtures)

    expect(seen).toHaveLength(2)
    for (const bytes of seen) expect(bytes.equals(fixtures.sentinel)).toBe(true)
  })
})

describe('case 9: version consistency', () => {
  it('fails a resolveVersion that disagrees with the result', async () => {
    await expectCaseFails(
      9,
      honestProvider({ resolveVersion: async () => '2.0.0' }),
      /providerVersion/
    )
  })

  it('fails an empty version', async () => {
    await expectCaseFails(9, honestProvider({ resolveVersion: async () => '' }), /non-empty/)
  })

  it('fails a result with no version when resolveVersion exists', async () => {
    await expectCaseFails(
      9,
      honestProvider({ result: ({ providerVersion: _removed, ...result }) => result }),
      /providerVersion/
    )
  })
})
