import { expect, it } from 'vitest'

import { catalogFindings, normalizeCatalogDefinition } from './catalog.js'
import cutover from './cutover-catalog.json' with { type: 'json' }

const prefix = 'byline_document_publish_schedules/constraint/'
const stateKey = `${prefix}check_document_publish_schedules_state`
const reasonKey = `${prefix}check_document_publish_schedules_suspended_reason`

// Observed with pg_get_constraintdef after pg_dump/restore and ALTER COLUMN ... TYPE.
const reparsed: Record<string, string> = {
  [stateKey]:
    "CHECK (((state)::text = ANY (ARRAY[('armed'::character varying)::text, ('needs_reconfirm'::character varying)::text])))|t|f|f|f",
  [reasonKey]:
    "CHECK (((suspended_reason IS NULL) OR ((suspended_reason)::text = ANY (ARRAY[('content_edited'::character varying)::text, ('document_metadata_changed'::character varying)::text, ('upgrade_invalidated'::character varying)::text]))))|t|f|f|f",
}

it('treats the re-parsed varchar IN form as the shipped constraint', () => {
  const expected: Record<string, string> = cutover
  for (const [key, definition] of Object.entries(reparsed))
    expect(normalizeCatalogDefinition(definition)).toBe(expected[key])
  expect(catalogFindings({ ...expected, ...reparsed })).toEqual([])
})

it('still reports a re-parsed constraint whose values differ', () => {
  const expected: Record<string, string> = cutover
  const altered = reparsed[stateKey]!.replace("'needs_reconfirm'", "'paused'")
  expect(catalogFindings({ ...expected, [stateKey]: altered }).map((f) => f.check)).toEqual([
    stateKey,
  ])
})

it('leaves other definitions unchanged', () => {
  const definition = "CHECK ((locale)::text = ANY (ARRAY['en'::text, 'fr'::text]))"
  expect(normalizeCatalogDefinition(definition)).toBe(definition)
})
