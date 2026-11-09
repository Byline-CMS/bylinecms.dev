/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// The conformance cases are plain async functions. They have no test-runner dependency,
// and `defineExtractionProviderConformance` registers them with Vitest.

import { readFileSync } from 'node:fs'

import type { ExtractionProvider, ExtractionResult, ExtractorCapabilities } from '@byline/core'
import {
  isExtractionProviderError,
  isFileExtractionFailure,
  validateExtractionArtifact,
  validatePageMap,
} from '@byline/core'

/**
 * The sentinel on each physical page of `sentinel.pdf`, in page order.
 *
 * @provisional
 */
export const SENTINELS = [
  'BYLINE-SENTINEL-PAGE-1',
  'BYLINE-SENTINEL-PAGE-2',
  'BYLINE-SENTINEL-PAGE-3',
] as const

const PDF = 'application/pdf'
// Outside any `type/*` wildcard a provider might plausibly list.
const UNSUPPORTED_TYPE = 'x-byline-conformance/unsupported'

/**
 * The hooks a driver author supplies.
 *
 * @provisional
 */
export interface ConformanceHooks {
  /** Shown in suite names, for example `'tika'`. */
  name: string
  createProvider(): ExtractionProvider | Promise<ExtractionProvider>
  /** A provider whose service cannot be reached. Enables case 6. */
  createUnavailableProvider?(): ExtractionProvider | Promise<ExtractionProvider>
  /** Per-case timeout in milliseconds. Default 60 seconds, for remote engines. */
  timeoutMs?: number
}

/**
 * The fixture files, as bytes.
 *
 * @provisional
 */
export interface ConformanceFixtures {
  sentinel: Buffer
  truncated: Buffer
  corrupt: Buffer
}

/**
 * Reads the fixtures shipped with this package.
 *
 * @provisional
 */
export function loadFixtures(): ConformanceFixtures {
  const read = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
  return {
    sentinel: read('sentinel.pdf'),
    truncated: read('truncated.pdf'),
    corrupt: read('corrupt.pdf'),
  }
}

/**
 * A provider broke a conformance rule.
 *
 * @provisional
 */
export class ConformanceFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConformanceFailure'
  }
}

/**
 * One conformance case. It resolves when the provider passes, resolves with `skipped`
 * when the case does not apply, and rejects with `ConformanceFailure` otherwise.
 *
 * @provisional
 */
export interface ExtractionProviderConformanceCase {
  id: number
  name: string
  run(
    hooks: ConformanceHooks,
    fixtures: ConformanceFixtures
  ): Promise<undefined | { skipped: string }>
}

const fail = (message: string, cause?: unknown): never => {
  throw new ConformanceFailure(message, cause === undefined ? undefined : { cause })
}

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

function acceptsPdf(capabilities: ExtractorCapabilities): boolean {
  return (
    Array.isArray(capabilities.formats) &&
    capabilities.formats.some(
      (format) => format === '*/*' || format === 'application/*' || format === PDF
    )
  )
}

/** A type the provider accepts, for cases that are not about formats. */
function declaredType(capabilities: ExtractorCapabilities): string {
  if (acceptsPdf(capabilities)) return PDF
  const first = capabilities.formats?.[0] ?? PDF
  return first.replace(/\*$/, 'plain')
}

const PDF_SKIP = {
  skipped: `This case uses a PDF fixture, and the provider does not accept ${PDF}.`,
}

/** Extracts the given bytes, passing a copy so a provider cannot change a fixture. */
function extract(
  provider: ExtractionProvider,
  bytes: Buffer,
  mimeType = PDF,
  filename = 'fixture.pdf'
): Promise<ExtractionResult> {
  return provider.extract({ data: new Uint8Array(bytes), filename, mimeType })
}

/** Extracts the sentinel fixture, which every accepting provider must handle. */
async function extractSentinel(
  provider: ExtractionProvider,
  fixtures: ConformanceFixtures
): Promise<ExtractionResult> {
  try {
    return await extract(provider, fixtures.sentinel)
  } catch (error) {
    return fail(`Extracting the sentinel fixture rejected: ${describeError(error)}`, error)
  }
}

/**
 * Every rule of a result's structural shape, including its page map against its own
 * `pageCount`. Whether the map's pages are the physical pages is case 4's question alone.
 */
function shapeProblems(provider: ExtractionProvider, result: ExtractionResult): string[] {
  const problems: string[] = []
  if (typeof result !== 'object' || result === null) return ['the result is not an object']
  if (result.provider !== provider.name) {
    problems.push(`result.provider is ${String(result.provider)}, not ${provider.name}`)
  }
  if (
    result.providerVersion !== undefined &&
    (typeof result.providerVersion !== 'string' || result.providerVersion === '')
  ) {
    problems.push('providerVersion must be a non-empty string when present')
  }
  const shape = validateExtractionArtifact(
    {
      ...result,
      schemaVersion: 1,
      contentHash: null,
      sourceVerified: false,
      providerVersion: null,
      producerConfigHash: null,
      producedAt: '2026-01-01T00:00:00.000Z',
    },
    { allowUnrecordedProducer: true }
  )
  if (!shape.ok) problems.push(...shape.issues.map((issue) => issue.message))
  return problems
}

const CAPABILITY_FLAGS = [
  'ocr',
  'markdown',
  'tables',
  'formulas',
  'charts',
  'coordinates',
  'pageMap',
  'structure',
] as const

const FORMAT = /^(\*\/\*|[a-z0-9.+-]+\/(\*|[a-z0-9.+-]+))$/i

/** Reads by index because `every` skips holes, and stops at the first bad slot. */
function isDenseFormatList(formats: readonly unknown[]): boolean {
  for (let i = 0; i < formats.length; i += 1) {
    const format = formats[i]
    if (typeof format !== 'string' || !FORMAT.test(format)) return false
  }
  return true
}

async function capabilityHonesty(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  const { capabilities } = provider
  for (const flag of CAPABILITY_FLAGS) {
    if (typeof capabilities?.[flag] !== 'boolean') fail(`capabilities.${flag} must be a boolean`)
  }
  if (
    !Array.isArray(capabilities.formats) ||
    capabilities.formats.length === 0 ||
    !isDenseFormatList(capabilities.formats)
  ) {
    fail('capabilities.formats must be a non-empty list of MIME types or wildcards')
  }
  if (!acceptsPdf(capabilities)) return undefined

  const result = await extractSentinel(provider, fixtures)
  for (const member of ['markdown', 'structure', 'pageMap'] as const) {
    const present = result[member] !== undefined
    if (present !== capabilities[member]) {
      fail(
        `capabilities.${member} is ${capabilities[member]}, ` +
          `but the result ${present ? 'has' : 'does not have'} that member`
      )
    }
  }
  return undefined
}

async function resultShape(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  if (!acceptsPdf(provider.capabilities)) return PDF_SKIP
  const problems = shapeProblems(provider, await extractSentinel(provider, fixtures))
  if (problems.length > 0) fail(problems.join('; '))
  return undefined
}

async function sentinelText(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  if (!acceptsPdf(provider.capabilities)) return PDF_SKIP
  const { plainText } = await extractSentinel(provider, fixtures)
  for (const sentinel of SENTINELS) {
    if (!plainText.includes(sentinel)) fail(`plainText does not contain ${sentinel}`)
  }
  return undefined
}

/** The only provenance check in the kit. Structural validity alone proves nothing. */
async function pageMapSentinels(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  if (!provider.capabilities.pageMap) {
    return { skipped: 'The provider declares capabilities.pageMap as false.' }
  }
  if (!acceptsPdf(provider.capabilities)) return PDF_SKIP

  const { plainText, pageMap } = await extractSentinel(provider, fixtures)
  if (pageMap === undefined) return fail('capabilities.pageMap is true, but there is no pageMap')
  const structure = validatePageMap(plainText, pageMap, { pageCount: SENTINELS.length })
  if (!structure.ok) {
    fail(`validatePageMap: ${structure.issues.map((issue) => issue.code).join(', ')}`)
  }

  SENTINELS.forEach((sentinel, i) => {
    const pageNumber = i + 1
    const page = pageMap.pages.find((candidate) => candidate.index === pageNumber)
    let found = false
    for (
      let at = plainText.indexOf(sentinel);
      at !== -1;
      at = plainText.indexOf(sentinel, at + 1)
    ) {
      const inPage =
        page !== undefined && at >= page.charStart && at + sentinel.length <= page.charEnd
      if (!inPage) fail(`${sentinel} at offset ${at} lies outside page ${pageNumber}`)
      found = true
    }
    if (!found) fail(`${sentinel} does not appear in page ${pageNumber}`)
  })
  return undefined
}

async function typedFileFailure(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  const { capabilities } = provider

  if (acceptsPdf(capabilities)) {
    // Recovering a damaged file is legitimate. Misreporting one is not.
    const truncated = await extract(provider, fixtures.truncated).then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    )
    if ('error' in truncated) {
      if (!isFileExtractionFailure(truncated.error)) {
        fail(
          'A truncated PDF must resolve or reject with a typed file failure, ' +
            `not ${describeError(truncated.error)}`,
          truncated.error
        )
      }
    } else {
      const problems = shapeProblems(provider, truncated.result)
      if (problems.length > 0) fail(`The truncated file's result: ${problems.join('; ')}`)
    }

    const corrupt = await extract(provider, fixtures.corrupt).then(
      () => null,
      (error: unknown) => ({ error })
    )
    if (corrupt === null) fail('A corrupt PDF must reject with a typed file failure, but resolved')
    else if (!isFileExtractionFailure(corrupt.error)) {
      fail(
        `A corrupt PDF must reject with a typed file failure, not ${describeError(corrupt.error)}`,
        corrupt.error
      )
    }
  }

  if (!capabilities.formats.includes('*/*')) {
    const unsupported = await extract(
      provider,
      fixtures.sentinel,
      UNSUPPORTED_TYPE,
      'fixture.bin'
    ).then(
      () => null,
      (error: unknown) => ({ error })
    )
    if (unsupported === null) {
      fail(`A type outside capabilities.formats must reject, but ${UNSUPPORTED_TYPE} resolved`)
    } else if (!isFileExtractionFailure(unsupported.error)) {
      fail(
        'A type outside capabilities.formats must reject with a typed file failure, ' +
          `not ${describeError(unsupported.error)}`,
        unsupported.error
      )
    }
  }
  return undefined
}

async function typedInfrastructureFailure(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  if (hooks.createUnavailableProvider === undefined) {
    return { skipped: 'No createUnavailableProvider hook was given.' }
  }
  const provider = await hooks.createUnavailableProvider()
  const rejection = await extract(
    provider,
    fixtures.sentinel,
    declaredType(provider.capabilities)
  ).then(
    () => null,
    (error: unknown) => ({ error })
  )
  if (
    rejection === null ||
    !isExtractionProviderError(rejection.error) ||
    rejection.error.failureScope !== 'infrastructure'
  ) {
    fail(
      'An unavailable service must reject with a typed infrastructure failure, not ' +
        (rejection === null ? 'a result' : describeError(rejection.error)),
      rejection?.error
    )
  }
  if (provider.ping !== undefined) {
    const pinged = await provider.ping().then(
      () => true,
      () => false
    )
    if (pinged) fail('ping must reject when the service is unavailable, but it resolved')
  }
  return undefined
}

async function abort(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  const controller = new AbortController()
  controller.abort()
  const rejection = await provider
    .extract({
      data: new Uint8Array(fixtures.sentinel),
      filename: 'fixture.pdf',
      mimeType: declaredType(provider.capabilities),
      signal: controller.signal,
    })
    .then(
      () => null,
      (error: unknown) => ({ error })
    )
  if (rejection === null) fail('An aborted signal must reject, but the extraction resolved')
  else if (isFileExtractionFailure(rejection.error)) {
    fail('An abort must not be reported as a file failure', rejection.error)
  }
  return undefined
}

async function inputForms(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  if (!acceptsPdf(provider.capabilities)) return PDF_SKIP
  const fromBytes = await extractSentinel(provider, fixtures)
  const copy = new Uint8Array(fixtures.sentinel)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(copy)
      controller.close()
    },
  })
  const fromStream = await provider
    .extract({ data: stream, filename: 'fixture.pdf', mimeType: PDF })
    .catch((error: unknown) =>
      fail(`Extracting from a stream rejected: ${describeError(error)}`, error)
    )
  if (fromStream.plainText !== fromBytes.plainText) {
    fail('Stream input and byte-array input gave different plainText')
  }
  return undefined
}

/** Assumes the engine does not change during the test run. */
async function versionConsistency(hooks: ConformanceHooks, fixtures: ConformanceFixtures) {
  const provider = await hooks.createProvider()
  if (provider.resolveVersion === undefined) {
    return { skipped: 'The provider does not implement resolveVersion.' }
  }
  const version = await provider.resolveVersion()
  if (typeof version !== 'string' || version === '') {
    fail('resolveVersion must resolve a non-empty string')
  }
  if (!acceptsPdf(provider.capabilities)) return PDF_SKIP
  const { providerVersion } = await extractSentinel(provider, fixtures)
  if (providerVersion !== version) {
    fail(`resolveVersion gave ${version}, but the result's providerVersion is ${providerVersion}`)
  }
  return undefined
}

/**
 * Every case, in specification order.
 *
 * @provisional
 */
export const extractionProviderConformanceCases: readonly ExtractionProviderConformanceCase[] = [
  { id: 1, name: 'capability honesty', run: capabilityHonesty },
  { id: 2, name: 'result shape', run: resultShape },
  { id: 3, name: 'sentinel text', run: sentinelText },
  { id: 4, name: 'page map sentinel verification', run: pageMapSentinels },
  { id: 5, name: 'typed file failure', run: typedFileFailure },
  { id: 6, name: 'typed infrastructure failure', run: typedInfrastructureFailure },
  { id: 7, name: 'abort', run: abort },
  { id: 8, name: 'input forms', run: inputForms },
  { id: 9, name: 'version consistency', run: versionConsistency },
]
