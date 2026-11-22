/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormRenderer } from './form-renderer'
import {
  createEditorViewStateStore,
  type EditorViewStateStore,
} from './view-state/editor-view-state'
import { beginActionRestore } from './view-state/restore-session'
import { documentActionMarker } from './view-state/target-markers'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [
    {
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    },
  ],
  slugifier: (value: string) => value.toLowerCase(),
})

const fields = [{ name: 'title', label: 'Title', type: 'text' as const }]
const doc = { id: 'doc', versionId: 'v7', revision: 7, status: 'draft', fields: { title: 'T' } }

let container: HTMLDivElement
let root: Root
let store: EditorViewStateStore

beforeEach(() => {
  store = createEditorViewStateStore()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(statusDisabled: boolean) {
  act(() => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider
          services={
            {
              getCollectionDocuments: async () => ({ docs: [], total: 0 }),
              uploadField: async () => ({}),
            } as any
          }
        >
          <FormRenderer
            mode="edit"
            fields={fields as any}
            initialLocale="en"
            initialData={doc}
            collectionPath="pages"
            viewState={store}
            onSubmit={() => {}}
            onCancel={() => {}}
            headerSlot={
              <span>
                <span {...documentActionMarker('action:status')}>
                  <button type="button" className="status" disabled={statusDisabled}>
                    Status
                  </button>
                </span>
                <span {...documentActionMarker('action:unpublish')}>
                  <button type="button" className="unpublish">
                    Unpublish
                  </button>
                </span>
              </span>
            }
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const frames = async (ms = 80) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('restoration after an in-visit action', () => {
  it('a newer eligible action is restored at once while an older one is still waiting, and the older never fires', async () => {
    render(true)
    // The older action's control is disabled, so its restoration waits.
    act(() => beginActionRestore(store, { role: 'action:status' }).record())
    expect(document.activeElement).toBe(document.body)

    // The newer action is eligible immediately: no poll or user event between.
    act(() => beginActionRestore(store, { role: 'action:unpublish' }).record())
    const unpublish = container.querySelector<HTMLButtonElement>('button.unpublish')
    expect(document.activeElement).toBe(unpublish)

    // The older action's control becomes usable; it must not take focus now.
    render(false)
    await frames()
    expect(document.activeElement).toBe(unpublish)
  })
})
