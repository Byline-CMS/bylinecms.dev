/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FindResult } from '@byline/client'
import { Card } from '@infonomic/uikit/react'

interface NewsListProps {
  result: FindResult
  category?: string
}

export function NewsList({ result, category }: NewsListProps) {
  const { docs, meta } = result

  return (
    <div>
      <header style={{ marginBottom: '1rem' }}>
        <p>
          {meta.total} {meta.total === 1 ? 'item' : 'items'}
          {category ? ` in “${category}”` : ''}
        </p>
      </header>

      {docs.length === 0 ? (
        <Card>
          <p>No news items found.</p>
        </Card>
      ) : (
        <ul
          style={{
            display: 'grid',
            gap: '1rem',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {docs.map((doc) => {
            const title =
              typeof doc.fields.title === 'string' ? doc.fields.title : (doc.path ?? doc.id)
            const categoryLabel = readPopulatedDisplay(doc.fields.category)
            return (
              <li key={doc.id}>
                <Card>
                  <h3 style={{ margin: 0 }}>{title}</h3>
                  {categoryLabel ? (
                    <p style={{ margin: '0.25rem 0 0', opacity: 0.7 }}>{categoryLabel}</p>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Tease a display label out of a populated relation envelope without
 * pulling in the full client renderer set yet — those components live in
 * a sibling project and will be ported over once the route is wired.
 */
function readPopulatedDisplay(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const target = (v.target ?? v.document) as Record<string, unknown> | undefined
  const fields = target?.fields as Record<string, unknown> | undefined
  const name = fields?.name
  return typeof name === 'string' ? name : undefined
}
