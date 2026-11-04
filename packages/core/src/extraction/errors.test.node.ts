/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  ExtractionProviderError,
  isExtractionProviderError,
  isFileExtractionFailure,
} from './errors.js'

function fromAnotherCopy(failureScope: string) {
  // Stands in for an error thrown by a second installed copy of @byline/core:
  // the same shape and brand, but a different class, so `instanceof` is false.
  class OtherExtractionProviderError extends Error {
    readonly code = 'ERR_EXTRACTION_PROVIDER'
    readonly failureScope = failureScope
    readonly retryable = false
  }
  return new OtherExtractionProviderError('from another copy')
}

describe('ExtractionProviderError', () => {
  it('carries its brand, scope, retry policy and cause', () => {
    const cause = new Error('socket closed')
    const error = new ExtractionProviderError('service failed', {
      failureScope: 'infrastructure',
      retryable: true,
      cause,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ExtractionProviderError')
    expect(error.code).toBe('ERR_EXTRACTION_PROVIDER')
    expect(error.failureScope).toBe('infrastructure')
    expect(error.retryable).toBe(true)
    expect(error.cause).toBe(cause)
  })
})

describe('isExtractionProviderError', () => {
  it('accepts a typed error from this copy and from another copy', () => {
    const typed = new ExtractionProviderError('bad', { failureScope: 'file', retryable: false })

    expect(isExtractionProviderError(typed)).toBe(true)
    expect(isExtractionProviderError(fromAnotherCopy('file'))).toBe(true)
  })

  it.each([
    ['an untyped error', new Error('boom')],
    ['an abort', new DOMException('aborted', 'AbortError')],
    ['a brand with an unknown scope', fromAnotherCopy('network')],
    ['a plain value', 'ERR_EXTRACTION_PROVIDER'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isExtractionProviderError(value)).toBe(false)
  })
})

describe('isFileExtractionFailure', () => {
  it('is true only for a typed file failure', () => {
    expect(
      isFileExtractionFailure(
        new ExtractionProviderError('corrupt', { failureScope: 'file', retryable: false })
      )
    ).toBe(true)
    expect(isFileExtractionFailure(fromAnotherCopy('file'))).toBe(true)
  })

  it.each([
    [
      'an infrastructure failure',
      new ExtractionProviderError('down', { failureScope: 'infrastructure', retryable: true }),
    ],
    ['an infrastructure failure from another copy', fromAnotherCopy('infrastructure')],
    ['an untyped error', new Error('corrupt')],
    ['an abort', new DOMException('aborted', 'AbortError')],
  ])('is false for %s', (_label, value) => {
    expect(isFileExtractionFailure(value)).toBe(false)
  })
})
