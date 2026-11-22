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
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormRenderer } from './form-renderer'
import { createEditorViewStateStore } from './view-state/editor-view-state'
import { useEditorViewState } from './view-state/editor-view-state-context'

const seen: Record<string, unknown> = {}

// Replace the layout with a probe so the test observes the context without
// depending on field widgets. The first layout also renders a nested form that
// is given no store.
vi.mock('./form-layout', () => {
  let nested = false
  return {
    FormLayout: () => {
      const store = useEditorViewState()
      const isNested = nested
      seen[isNested ? 'nested' : 'outer'] = store
      if (!nested) {
        nested = true
        // A portal keeps the nested form out of the outer <form>; context still flows.
        return createPortal(
          <FormRenderer
            mode="create"
            fields={[]}
            onSubmit={() => {}}
            onCancel={() => {}}
            collectionPath="pages"
            initialData={{ fields: {} }}
          />,
          document.body
        )
      }
      return null
    },
  }
})

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [{ path: 'pages', labels: { singular: 'Page', plural: 'Pages' }, fields: [] }],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('FormRenderer view state', () => {
  it('a nested FormRenderer without viewState does not see the parent store', () => {
    const store = createEditorViewStateStore()
    act(() => {
      root.render(
        <I18nProvider
          bundle={adminTranslations({ locales: ['en'] })}
          activeLocale="en"
          defaultLocale="en"
          localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
        >
          <BylineFieldServicesProvider services={{} as any}>
            <FormRenderer
              mode="edit"
              fields={[]}
              onSubmit={() => {}}
              onCancel={() => {}}
              collectionPath="pages"
              initialData={{ id: 'doc-1', fields: {} }}
              viewState={store}
            />
          </BylineFieldServicesProvider>
        </I18nProvider>
      )
    })
    expect('nested' in seen).toBe(true)
    expect(seen.outer).toBe(store)
    expect(seen.nested).toBeNull()
  })
})
