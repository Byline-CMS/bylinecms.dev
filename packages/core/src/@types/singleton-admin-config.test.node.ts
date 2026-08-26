/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defineAdmin, defineSingletonAdmin, type FormAdminConfig } from './admin-types.js'
import { defineCollection, defineSingleton } from './collection-types.js'

const pages = defineCollection({
  path: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

const settings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

describe('singleton admin config', () => {
  it('stamps explicit resource-kind discriminants in both factories', () => {
    const collectionAdmin = defineAdmin(pages, {})
    const singletonAdmin = defineSingletonAdmin(settings, {})

    expect(collectionAdmin.singleton).toBe(false)
    expect(singletonAdmin.singleton).toBe(true)
    expect(singletonAdmin.slug).toBe(settings.path)
  })

  it('shares the reusable form composition contract', () => {
    const singletonAdmin = defineSingletonAdmin(settings, {
      fields: { title: {} },
      layout: { main: ['title'] },
    })
    const asForm: FormAdminConfig = singletonAdmin

    expect(asForm.layout).toEqual({ main: ['title'] })
  })

  it('rejects collection-only admin options at the definition site', () => {
    defineSingletonAdmin(settings, {
      // @ts-expect-error — list columns have no meaning for a singleton resource.
      columns: [{ fieldName: 'title', label: 'Title' }],
    })
  })

  it('keeps the singleton preview document pathless', () => {
    defineSingletonAdmin(settings, {
      preview: {
        url: (document) => {
          // @ts-expect-error — a singleton's internal generated path is never preview input.
          expect(document.path).toBeUndefined()
          return '/'
        },
      },
    })
  })
})
