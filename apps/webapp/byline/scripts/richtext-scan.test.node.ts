/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldCapabilities } from '@byline/richtext-lexical'
import { scanDocument, summarise } from '@byline/richtext-lexical'
import { describe, expect, it } from 'vitest'

import { toDeclarationPath } from './lib/richtext-scan-paths.js'

// biome-ignore lint/suspicious/noExplicitAny: serialized fixtures are structural
const doc = (...children: unknown[]): any => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})
const heading = () => ({
  children: [],
  direction: null,
  format: '',
  indent: 0,
  type: 'heading',
  version: 1,
  tag: 'h1',
})

describe('toDeclarationPath', () => {
  it('leaves a top-level field alone', () => {
    expect(toDeclarationPath('body')).toBe('body')
  })

  it('drops the item index from a block-nested field', () => {
    // Storage addresses the value; the manifest addresses the declaration.
    expect(toDeclarationPath('content.1.photoBlock.caption')).toBe('content.photoBlock.caption')
  })

  it('drops every index from a field nested in an array inside a block', () => {
    expect(toDeclarationPath('content.2.faqBlock.faq.0.answer')).toBe('content.faqBlock.faq.answer')
  })

  it('keeps a field whose name merely contains digits', () => {
    expect(toDeclarationPath('content.1.photoBlock.caption2')).toBe('content.photoBlock.caption2')
  })
})

describe('scanning stored values', () => {
  const caption: FieldCapabilities = {
    collectionPath: 'news',
    fieldPath: 'content.photoBlock.caption',
    supportedTypes: ['root', 'paragraph', 'text'],
  }

  it('matches a nested, localized stored value to its declaration', () => {
    const finding = scanDocument(doc(heading()), caption, {
      documentId: 'doc-1',
      versionId: 'ver-3',
      locale: 'fr',
    })
    expect(finding?.fieldPath).toBe('content.photoBlock.caption')
    expect(finding?.locale).toBe('fr')
    expect(finding?.adaptedTypes).toEqual(['heading'])
  })

  it('reports an archived version as well as the current one', () => {
    // An editor restoring an archived version loads it exactly as a
    // current one, so a stray structure there is just as reachable.
    const versions = ['ver-1', 'ver-2', 'ver-3'].map((versionId) =>
      scanDocument(doc(heading()), caption, { documentId: 'doc-1', versionId })
    )
    expect(versions.every((finding) => finding != null)).toBe(true)
    expect(versions.map((finding) => finding?.versionId)).toEqual(['ver-1', 'ver-2', 'ver-3'])
  })

  it('reports an unmeasured field instead of passing its documents', () => {
    const unknown: FieldCapabilities = { ...caption, supportedTypes: null, unresolvedReason: 'x' }
    const clean = doc({
      children: [],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    })
    const finding = scanDocument(clean, unknown, { documentId: 'doc-1', versionId: 'ver-1' })
    expect(finding?.unmapped).toBe(true)
    expect(summarise([finding!]).unmapped).toHaveLength(1)
  })
})
