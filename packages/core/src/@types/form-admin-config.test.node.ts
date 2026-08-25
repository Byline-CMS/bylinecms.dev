/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest'

import type { CollectionAdminConfig, FormAdminConfig } from './admin-types.js'

describe('FormAdminConfig', () => {
  it('accepts a config carrying only the form-facing keys', () => {
    const config: FormAdminConfig = {
      fields: {},
      tabSets: [],
      rows: [],
      groups: [],
      layout: { main: [] },
    }

    expect(Object.keys(config).sort()).toEqual(['fields', 'groups', 'layout', 'rows', 'tabSets'])
  })

  it('is satisfied by a full CollectionAdminConfig', () => {
    const collection: CollectionAdminConfig = {
      slug: 'pages',
      layout: { main: [] },
    }
    const asForm: FormAdminConfig = collection

    expect(asForm.layout).toEqual({ main: [] })
  })
})
