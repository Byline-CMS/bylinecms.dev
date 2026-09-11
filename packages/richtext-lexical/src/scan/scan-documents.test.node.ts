import { describe, expect, it } from 'vitest'

import { scanDocument, summarise } from './scan-documents'
import type { FieldCapabilities } from './types'

const caps: FieldCapabilities = {
  collectionPath: 'publications',
  fieldPath: 'title',
  supportedTypes: ['root', 'paragraph', 'text'],
}
const ids = { documentId: 'doc-1', versionId: 'ver-1' }
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

describe('scanDocument', () => {
  it('reports nothing for a clean document', () => {
    const clean = doc({
      children: [],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    })
    expect(scanDocument(clean, caps, ids)).toBeUndefined()
  })

  it('reports nothing for an absent value', () => {
    expect(scanDocument(undefined, caps, ids)).toBeUndefined()
    expect(scanDocument(null, caps, ids)).toBeUndefined()
  })

  it('reports an adaptable heading', () => {
    const finding = scanDocument(doc(heading()), caps, ids)
    expect(finding?.adaptedTypes).toEqual(['heading'])
    expect(finding?.refusedTypes).toEqual([])
  })

  it('reports a refusing inline image separately', () => {
    const finding = scanDocument(doc({ type: 'inline-image', version: 1 }), caps, ids)
    expect(finding?.refusedTypes).toContain('inline-image')
    expect(finding?.adaptedTypes).toEqual([])
  })

  it('keeps the stored instance path so sibling values are distinguishable', () => {
    // Two captions in one block field share a declaration path; only the
    // instance path tells them apart.
    const first = scanDocument(doc(heading()), caps, {
      ...ids,
      instancePath: 'content.1.photoBlock.caption',
    })
    const second = scanDocument(doc(heading()), caps, {
      ...ids,
      instancePath: 'content.3.photoBlock.caption',
    })
    expect(first?.instancePath).toBe('content.1.photoBlock.caption')
    expect(second?.instancePath).toBe('content.3.photoBlock.caption')
    expect(first?.fieldPath).toBe(second?.fieldPath)
  })

  it('reports findings against a localized, nested field path', () => {
    const nested = { ...caps, fieldPath: 'content.1.photoBlock.caption' }
    const finding = scanDocument(doc(heading()), nested, { ...ids, locale: 'fr' })
    expect(finding?.fieldPath).toBe('content.1.photoBlock.caption')
    expect(finding?.locale).toBe('fr')
  })

  it('reports an archived version distinctly from the current one', () => {
    const current = scanDocument(doc(heading()), caps, { documentId: 'doc-1', versionId: 'ver-2' })
    const archived = scanDocument(doc(heading()), caps, { documentId: 'doc-1', versionId: 'ver-1' })
    expect(current?.versionId).toBe('ver-2')
    expect(archived?.versionId).toBe('ver-1')
  })

  it('reports a field whose capabilities were never measured, rather than silence', () => {
    const unknown: FieldCapabilities = {
      ...caps,
      supportedTypes: null,
      unresolvedReason: 'no editor',
    }
    const finding = scanDocument(doc(heading()), unknown, ids)
    expect(finding?.unmapped).toBe(true)
    expect(finding?.adaptedTypes).toEqual([])
    expect(finding?.refusedTypes).toEqual([])
  })

  it('reports unmapped even for content that would otherwise look clean', () => {
    const unknown: FieldCapabilities = { ...caps, supportedTypes: null }
    const clean = doc({
      children: [],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    })
    // The point of the rule: a clean-looking document under unknown
    // capabilities is still unexamined.
    expect(scanDocument(clean, unknown, ids)?.unmapped).toBe(true)
  })

  it('separates what will adapt from what will open read-only', () => {
    const findings = [
      scanDocument(doc(heading()), caps, ids),
      scanDocument(doc({ type: 'youtube', version: 1 }), caps, { ...ids, versionId: 'ver-2' }),
    ].filter((finding): finding is NonNullable<typeof finding> => finding != null)

    const { adapted, refused, unmapped } = summarise(findings)
    expect(adapted).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(unmapped).toHaveLength(0)
    expect(refused[0]?.refusedTypes).toContain('youtube')
  })
})
