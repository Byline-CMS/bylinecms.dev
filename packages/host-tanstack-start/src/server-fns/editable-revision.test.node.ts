import { describe, expect, it } from 'vitest'

import { withEditableRevision } from './editable-revision.js'

describe('editable response revision binding', () => {
  const observed = { id: 'document', versionId: 'current', revision: 7 }
  it('restores only the source revision without changing populated targets', () => {
    const related = { id: 'related', versionId: 'published', fields: {} }
    expect(
      withEditableRevision({ id: 'document', versionId: 'current', fields: { related } }, observed)
    ).toEqual({ id: 'document', versionId: 'current', revision: 7, fields: { related } })
    expect(related).not.toHaveProperty('revision')
  })
  it.each([
    { id: 'document', versionId: 'historical' },
    { id: 'another-document', versionId: 'current' },
  ])('rejects a transferred observation: %o', (document) => {
    expect(() => withEditableRevision(document, observed)).toThrow('source observation')
  })
  it('rejects a row removed from the editable result', () => {
    expect(() => withEditableRevision(observed, undefined)).toThrow('source observation')
  })
})
