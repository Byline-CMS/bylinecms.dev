/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchDocument, SearchFacetValue, SearchField } from '@byline/core'

/** The four adapter-neutral relevance classes, A (highest) through D. */
export type WeightClass = 'A' | 'B' | 'C' | 'D'

/** Flat MySQL row input derived from one type-enriched search document. */
export interface IndexRow {
  collectionPath: string
  documentId: string
  locale: string
  status: string
  zones: string[]
  title: string
  path: string | null
  body: string
  weighted: Record<WeightClass, string>
  facets: Record<string, SearchFacetValue[]>
  filters: Record<string, string | number | boolean>
  updatedAt: string
}

export function weightClass(boost: number | undefined, defaultClass: WeightClass): WeightClass {
  if (boost == null) return defaultClass
  if (boost >= 2) return 'A'
  if (boost >= 1) return 'B'
  if (boost >= 0.5) return 'C'
  return 'D'
}

/**
 * Project searchable values into the same A–D buckets used by the PostgreSQL
 * and Solr adapters. Titles remain display-only unless explicitly included in
 * the collection's body declaration.
 */
export function buildIndexRow(doc: SearchDocument): IndexRow {
  const weighted: Record<WeightClass, string[]> = { A: [], B: [], C: [], D: [] }
  const facets: Record<string, SearchFacetValue[]> = {}
  const filters: Record<string, string | number | boolean> = {}

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
          for (const value of values) {
            if (value.term) weighted[cls].push(value.term)
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

  const join = (parts: string[]): string => parts.join('\n')
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
      .filter((text) => text.length > 0)
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
