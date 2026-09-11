/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldCapabilities } from '@byline/richtext-lexical/scan'
import { describe, expect, it } from 'vitest'

import { buildScanReport, type StoredValue, shouldFail } from './lib/richtext-scan-report.js'

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
const paragraph = () => ({
  children: [],
  direction: null,
  format: '',
  indent: 0,
  type: 'paragraph',
  version: 1,
})

const INLINE_ONLY = ['root', 'paragraph', 'text', 'linebreak', 'tab']

const caption: FieldCapabilities = {
  collectionPath: 'pages',
  fieldPath: 'content.photoBlock.caption',
  supportedTypes: INLINE_ONLY,
}

const stored = (fieldPath: string, value: unknown, versionId = 'ver-1'): StoredValue => ({
  collectionPath: 'pages',
  documentId: 'doc-1',
  versionId,
  fieldPath,
  locale: 'en',
  value,
})

const DECLARED = new Set([
  'pages::content.photoBlock.caption',
  'pages::content.richTextBlock.richText',
])

describe('buildScanReport', () => {
  it('skips values belonging to ordinary json fields', () => {
    // Decided by the SCHEMA, not the manifest — which is what makes
    // skipping them safe.
    const report = buildScanReport({
      stored: [stored('settings', { anything: true })],
      declared: DECLARED,
      manifestFields: [caption],
    })
    expect(report.plainJsonValues).toBe(1)
    expect(report.findings).toEqual([])
    expect(shouldFail(report, [caption])).toBe(false)
  })

  it('reports a value the field will adapt', () => {
    const report = buildScanReport({
      stored: [stored('content.1.photoBlock.caption', doc(heading()))],
      declared: DECLARED,
      manifestFields: [caption],
    })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.adaptedTypes).toEqual(['heading'])
    expect(shouldFail(report, [caption])).toBe(false)
  })

  it('distinguishes two affected captions in one version', () => {
    const report = buildScanReport({
      stored: [
        stored('content.1.photoBlock.caption', doc(heading())),
        stored('content.3.photoBlock.caption', doc(heading())),
      ],
      declared: DECLARED,
      manifestFields: [caption],
    })
    expect(report.findings.map((finding) => finding.instancePath)).toEqual([
      'content.1.photoBlock.caption',
      'content.3.photoBlock.caption',
    ])
  })
})

describe('a stale manifest', () => {
  const staleInputs = {
    stored: [
      // A richtext field the schema declares and the manifest omits.
      stored('content.0.richTextBlock.richText', doc(heading())),
      // ...including one whose content looks perfectly clean.
      stored('content.1.richTextBlock.richText', doc(paragraph()), 'ver-2'),
    ],
    declared: DECLARED,
    manifestFields: [caption],
  }

  it('names the field the schema declares but the manifest omits', () => {
    const report = buildScanReport(staleInputs)
    expect(report.missingFromManifest).toEqual(['pages::content.richTextBlock.richText'])
  })

  it('reports every value of that field as unexamined, not clean', () => {
    const report = buildScanReport(staleInputs)
    expect(report.findings).toHaveLength(2)
    expect(report.findings.every((finding) => finding.unmapped === true)).toBe(true)
    // The clean-looking value is reported too: it was never examined.
    expect(report.findings[1]?.unmapped).toBe(true)
  })

  it('fails the process', () => {
    const report = buildScanReport(staleInputs)
    expect(shouldFail(report, [caption])).toBe(true)
  })
})

describe('shouldFail', () => {
  const clean = buildScanReport({
    stored: [stored('content.1.photoBlock.caption', doc(paragraph()))],
    declared: DECLARED,
    manifestFields: [caption],
  })

  it('passes a clean scan against a complete manifest', () => {
    expect(shouldFail(clean, [caption])).toBe(false)
  })

  it('fails when the manifest carries an unmeasured field, even with no findings', () => {
    const unmeasured: FieldCapabilities = {
      collectionPath: 'pages',
      fieldPath: 'content.faqBlock.faq.answer',
      supportedTypes: null,
      unresolvedReason: 'Editor did not mount.',
    }
    expect(shouldFail(clean, [caption, unmeasured])).toBe(true)
  })

  it('fails when content would open read-only', () => {
    const report = buildScanReport({
      stored: [stored('content.1.photoBlock.caption', doc({ type: 'inline-image', version: 1 }))],
      declared: DECLARED,
      manifestFields: [caption],
    })
    expect(report.findings[0]?.refusedTypes).toContain('inline-image')
    expect(shouldFail(report, [caption])).toBe(true)
  })
})
