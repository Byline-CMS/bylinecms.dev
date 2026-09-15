/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// base-ui's Modal portals into a floating layer jsdom cannot position, and the
// contract under test is what the picker puts *into* the modal.
vi.mock('@byline/ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: any) => <div>{children}</div>
  const Modal: any = ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null)
  Modal.Container = Pass
  Modal.Header = Pass
  Modal.Content = Pass
  Modal.Actions = Pass
  return {
    ...actual,
    Modal,
    Search: ({ placeholder }: any) => <input aria-label="search" placeholder={placeholder} />,
    LoaderRing: () => <span />,
  }
})

import { BylineFieldServicesProvider } from '../field-services-context'
import { RelationPicker } from './relation-picker'

const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [
    {
      path: 'media',
      labels: { singular: 'Media item', plural: 'Media' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    },
  ],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

const targetDefinition = {
  path: 'media',
  labels: { singular: 'Media item', plural: 'Media' },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
} as any

const emptyList = async () => ({
  docs: [],
  meta: { totalPages: 1 },
  included: { collection: { id: 'collection-1' } },
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

const render = (services: Record<string, unknown>, props: Record<string, unknown> = {}) => {
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
            { getCollectionDocuments: emptyList, uploadField: async () => ({}), ...services } as any
          }
        >
          <RelationPicker
            targetCollectionPath="media"
            targetDefinition={targetDefinition}
            displayField="title"
            isOpen={true}
            onSelect={() => {}}
            onDismiss={() => {}}
            {...(props as any)}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const createLink = () =>
  container.querySelector<HTMLAnchorElement>('.byline-field-relation-picker-create')

const bothCapabilities = {
  canCreateInCollection: () => true,
  getCreateDocumentUrl: (path: string) => `/control-panel/collections/${path}/create`,
}

describe('relation picker create affordance', () => {
  it('is absent when the host wires no capabilities', () => {
    render({})

    expect(createLink()).toBeNull()
  })

  /**
   * Permission is unknowable without `canCreateInCollection`, and offering a link
   * that leads to a refusal is worse than offering none.
   */
  it('is absent when only the url capability is wired', () => {
    render({ getCreateDocumentUrl: (path: string) => `/x/${path}/create` })

    expect(createLink()).toBeNull()
  })

  it('is absent when only the permission capability is wired', () => {
    render({ canCreateInCollection: () => true })

    expect(createLink()).toBeNull()
  })

  it('is absent when the viewer may not create in the target collection', () => {
    render({ ...bothCapabilities, canCreateInCollection: () => false })

    expect(createLink()).toBeNull()
  })

  it('asks about the target collection, not some other one', () => {
    const canCreateInCollection = vi.fn(() => true)
    render({ ...bothCapabilities, canCreateInCollection })

    expect(canCreateInCollection).toHaveBeenCalledWith('media')
  })

  it('renders the host-supplied url when permitted', () => {
    render(bothCapabilities)

    expect(createLink()?.getAttribute('href')).toBe('/control-panel/collections/media/create')
  })

  /**
   * A new tab is the whole point: the parent editor and this picker stay mounted
   * with their unsaved state. `noopener` because the opened page must not reach
   * back into this one through `window.opener`.
   */
  it('opens in a new tab without handing over a window reference', () => {
    render(bothCapabilities)

    expect(createLink()?.getAttribute('target')).toBe('_blank')
    expect(createLink()?.getAttribute('rel')).toContain('noopener')
  })

  it('names the target collection so the reader knows what they are creating', () => {
    render(bothCapabilities)

    expect(createLink()?.textContent).toContain('Media item')
  })

  /**
   * An anchor rather than a button calling `window.open`: keyboard and
   * middle-click work for free, and popup blockers leave it alone.
   */
  it('is a real link, reachable by keyboard', () => {
    render(bothCapabilities)

    const link = createLink()
    expect(link?.tagName).toBe('A')
    expect(link?.getAttribute('href')).toBeTruthy()
  })

  it('does not dismiss the picker when followed', () => {
    const onDismiss = vi.fn()
    render(bothCapabilities, { onDismiss })

    act(() => {
      createLink()?.click()
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })
})
