import { describe, expect, it } from 'vitest'

import { classifyDbTarget } from './state.js'

describe.each([
  [{ exists: false, objects: [] }, 'missing'],
  [{ exists: true, objects: [] }, 'empty'],
  [{ exists: true, objects: ['byline_documents'] }, 'byline-schema'],
  [{ exists: true, objects: ['BYLINE_DOCUMENTS'] }, 'byline-schema'],
  [{ exists: true, objects: ['posts'] }, 'occupied-schema'],
  [{ exists: true, objects: ['posts', 'byline_documents'] }, 'byline-schema'],
  [{ exists: true, objects: ['current_documents_view'] }, 'occupied-schema'],
  [{ exists: true, objects: ['__drizzle_migrations'] }, 'occupied-schema'],
] as const)('database target classification', (inspection, expected) => {
  it(`classifies ${JSON.stringify(inspection)} as ${expected}`, () => {
    expect(classifyDbTarget({ ...inspection, objects: [...inspection.objects] })).toBe(expected)
  })
})
