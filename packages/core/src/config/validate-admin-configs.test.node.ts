/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { validateAdminConfigs } from './validate-admin-configs.js'
import type { CollectionAdminConfig, CollectionDefinition } from '../@types/index.js'

const collection: CollectionDefinition = {
  path: 'news',
  labels: { singular: 'News', plural: 'News' },
  useAsPath: 'title',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'summary', label: 'Summary', type: 'textArea' },
    { name: 'content', label: 'Content', type: 'richText' },
    { name: 'text1', label: 'Text 1', type: 'text' },
    { name: 'text2', label: 'Text 2', type: 'text' },
  ],
}

const baseAdmin: CollectionAdminConfig = {
  slug: 'news',
  tabSets: [
    {
      name: 'main',
      tabs: [
        { name: 'details', label: 'Details', fields: ['title', 'summary', 'titles'] },
        { name: 'content', label: 'Content', fields: ['content'] },
      ],
    },
  ],
  rows: [{ name: 'titles', fields: ['text1', 'text2'] }],
  layout: { main: ['main'] },
}

describe('validateAdminConfigs', () => {
  it('accepts a valid admin config (baseline)', () => {
    expect(() => validateAdminConfigs([baseAdmin], [collection])).not.toThrow()
  })

  it('is a no-op when admins is undefined', () => {
    expect(() => validateAdminConfigs(undefined, [collection])).not.toThrow()
  })

  // Rule 1 — slug pairing.
  it('rejects an admin config whose slug has no matching collection', () => {
    const orphan: CollectionAdminConfig = { slug: 'nonexistent', layout: { main: [] } }
    expect(() => validateAdminConfigs([orphan], [collection])).toThrow(/no matching collection/)
  })

  // Rule 2 — placement bookkeeping.
  it('rejects an admin config that leaves a schema field unplaced', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      tabSets: [
        {
          name: 'main',
          tabs: [
            // omit 'summary' from the details tab
            { name: 'details', label: 'Details', fields: ['title', 'titles'] },
            { name: 'content', label: 'Content', fields: ['content'] },
          ],
        },
      ],
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(/"summary" is not placed/)
  })

  it('rejects placing the same schema field twice', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      layout: { main: ['main'], sidebar: ['title'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(/placed more than once/)
  })

  // Rule 3 — name resolution + path rejection.
  it('rejects unknown names in a layout region', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      layout: { main: ['main', 'doesNotExist'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /"doesNotExist", which is neither a top-level schema field nor a declared primitive/
    )
  })

  it("rejects 'path' in layout.sidebar with a useAsPath hint", () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      layout: { main: ['main'], sidebar: ['path'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(/useAsPath/)
  })

  it("rejects 'path' inside a tab", () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      tabSets: [
        {
          name: 'main',
          tabs: [
            {
              name: 'details',
              label: 'Details',
              fields: ['title', 'summary', 'titles', 'path'],
            },
            { name: 'content', label: 'Content', fields: ['content'] },
          ],
        },
      ],
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(/useAsPath/)
  })

  // Rule 4 — collisions.
  it('rejects a primitive name that collides with a schema field', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      rows: [
        { name: 'titles', fields: ['text1', 'text2'] },
        // 'title' is also a schema field — collision
        { name: 'title', fields: ['summary'] },
      ],
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /collides with a schema field/
    )
  })

  it('rejects two primitives sharing the same name', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      rows: [{ name: 'titles', fields: ['text1', 'text2'] }],
      groups: [{ name: 'titles', label: 'X', fields: ['summary'] }],
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /collides with another primitive/
    )
  })

  // Rule 5 — nesting.
  it('rejects a row whose fields include a non-field primitive', () => {
    const admin: CollectionAdminConfig = {
      slug: 'news',
      tabSets: [
        {
          name: 'main',
          tabs: [
            { name: 'details', label: 'Details', fields: ['title', 'summary', 'badRow'] },
            { name: 'content', label: 'Content', fields: ['content'] },
          ],
        },
      ],
      groups: [{ name: 'someGroup', fields: ['text1'] }],
      rows: [
        // Row contains a group name — illegal.
        { name: 'badRow', fields: ['text2', 'someGroup'] },
      ],
      layout: { main: ['main'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /can only contain schema field names/
    )
  })

  it('rejects a tab set referenced from inside a tab', () => {
    const admin: CollectionAdminConfig = {
      slug: 'news',
      tabSets: [
        {
          name: 'inner',
          tabs: [{ name: 'a', label: 'A', fields: ['text1', 'text2'] }],
        },
        {
          name: 'outer',
          tabs: [
            // Embedding the inner tab set inside a tab is illegal.
            { name: 'wrapper', label: 'Wrapper', fields: ['title', 'summary', 'inner'] },
            { name: 'content', label: 'Content', fields: ['content'] },
          ],
        },
      ],
      layout: { main: ['outer'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(/Tab sets are top-level only/)
  })

  it('rejects a tab set referenced from layout.sidebar', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      layout: { main: [], sidebar: ['main'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /Tab sets are only allowed in `layout.main`/
    )
  })

  it('rejects a group nested inside another group', () => {
    const admin: CollectionAdminConfig = {
      slug: 'news',
      tabSets: [
        {
          name: 'main',
          tabs: [
            { name: 'details', label: 'Details', fields: ['title', 'summary', 'outer'] },
            { name: 'content', label: 'Content', fields: ['content'] },
          ],
        },
      ],
      groups: [
        { name: 'outer', label: 'Outer', fields: ['text1', 'inner'] },
        { name: 'inner', label: 'Inner', fields: ['text2'] },
      ],
      layout: { main: ['main'] },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(/Groups do not nest/)
  })

  // Rule 6 — `fields` map sanity.
  it('rejects a `fields` map key that is not a schema field name', () => {
    const admin: CollectionAdminConfig = {
      ...baseAdmin,
      fields: { nonexistent: {} },
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /not a top-level schema field/
    )
  })

  // Layout omitted — bookkeeping skipped, primitive declarations still checked.
  it('skips placement bookkeeping when layout is omitted', () => {
    const admin: CollectionAdminConfig = {
      slug: 'news',
      // No layout — renderer will synthesise a default.
    }
    expect(() => validateAdminConfigs([admin], [collection])).not.toThrow()
  })

  it('still rejects a primitive collision when layout is omitted', () => {
    const admin: CollectionAdminConfig = {
      slug: 'news',
      rows: [
        { name: 'titles', fields: ['text1', 'text2'] },
        // 'title' is also a schema field — collision still caught.
        { name: 'title', fields: ['summary'] },
      ],
    }
    expect(() => validateAdminConfigs([admin], [collection])).toThrow(
      /collides with a schema field/
    )
  })
})
