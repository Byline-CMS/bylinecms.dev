/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchDocument, SearchFacetValue, SearchField } from '@byline/core'

/** The four Postgres tsvector weight classes, A (highest) … D (lowest). */
export type WeightClass = 'A' | 'B' | 'C' | 'D'

/**
 * A flat, driver-shaped row derived from a type-enriched `SearchDocument`.
 * The text is pre-bucketed by weight class so the provider can assemble the
 * `tsvector` as a fixed `setweight(to_tsvector(cfg, $A),'A') || …` expression
 * with one bind per class.
 */
export interface IndexRow {
  collectionPath: string
  documentId: string
  locale: string
  status: string
  zones: string[]
  title: string
  path: string | null
  /** Concatenated searchable text — stored for snippets / highlighting. */
  body: string
  /** Searchable text grouped by tsvector weight class. */
  weighted: Record<WeightClass, string>
  /** Facet projection for aggregation: `{ topics: [{ id, term }, …] }`. */
  facets: Record<string, SearchFacetValue[]>
  /** Filterable / sortable scalars. */
  filters: Record<string, string | number | boolean>
  updatedAt: string
}

/**
 * Map a relevance `boost` (and a per-role default) to a tsvector weight
 * class. Higher boost → heavier class. Unset boost uses the role default.
 */
export function weightClass(boost: number | undefined, defaultClass: WeightClass): WeightClass {
  if (boost == null) return defaultClass
  if (boost >= 2) return 'A'
  if (boost >= 1) return 'B'
  if (boost >= 0.5) return 'C'
  return 'D'
}

/**
 * Transform a `SearchDocument` into the flat `IndexRow` the provider writes.
 * Pure — no SQL, no DB. The title always weights `A`; body text weights by
 * boost (default `B`); facet terms weight by boost (default `C`) and their
 * ids are projected into `facets`; filters are projected as-is.
 */
export function buildIndexRow(doc: SearchDocument): IndexRow {
  const weighted: Record<WeightClass, string[]> = { A: [], B: [], C: [], D: [] }
  const facets: Record<string, SearchFacetValue[]> = {}
  const filters: Record<string, string | number | boolean> = {}

  // The identity value always carries the most weight.
  if (doc.title) weighted.A.push(doc.title)

  for (const field of doc.fields) {
    switch (field.role) {
      case 'body': {
        const text = textValue(field.value)
        if (text) weighted[weightClass(field.boost, 'B')].push(text)
        break
      }
      case 'facet': {
        const values = Array.isArray(field.value) ? (field.value as SearchFacetValue[]) : []
        if (values.length > 0) {
          facets[field.name] = values
          const cls = weightClass(field.boost, 'C')
          for (const v of values) {
            if (v.term) weighted[cls].push(v.term)
          }
        }
        break
      }
      case 'filter': {
        if (
          typeof field.value === 'string' ||
          typeof field.value === 'number' ||
          typeof field.value === 'boolean'
        ) {
          filters[field.name] = field.value
        }
        break
      }
    }
  }

  const join = (parts: string[]) => parts.join('\n')
  const weightedText: Record<WeightClass, string> = {
    A: join(weighted.A),
    B: join(weighted.B),
    C: join(weighted.C),
    D: join(weighted.D),
  }

  return {
    collectionPath: doc.collectionPath,
    documentId: doc.documentId,
    locale: doc.locale,
    status: doc.status,
    zones: doc.zones,
    title: doc.title,
    path: doc.path,
    body: [weightedText.A, weightedText.B, weightedText.C, weightedText.D]
      .filter((t) => t.length > 0)
      .join('\n'),
    weighted: weightedText,
    facets,
    filters,
    updatedAt: doc.updatedAt,
  }
}

function textValue(value: SearchField['value']): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}
