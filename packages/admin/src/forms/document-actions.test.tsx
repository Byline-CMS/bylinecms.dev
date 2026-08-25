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

import { BylineFieldServicesProvider } from '../fields/field-services-context'

// Spread the REAL uikit and override only the three primitives that make
// assertions hard. A factory mock replaces the whole module, so anything not
// returned becomes `undefined` and React throws "Element type is invalid" on
// mount — FormRenderer alone pulls in Alert, Button, and ComboButton
// (`form-renderer.tsx:24`), and its field/presentation subtree pulls in more.
// `@byline/ui` ships a built `dist` plus a `development` source condition, so
// `importOriginal()` resolves without a prior build step.
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
    Dropdown: {
      Root: Pass,
      Trigger: ({ children }: any) => <div data-testid="actions-trigger">{children}</div>,
      Portal: Pass,
      Content: Pass,
      Item: ({ children, onClick }: any) => (
        <div
          onClick={onClick}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onClick?.(event)
          }}
          role="menuitem"
          tabIndex={0}
        >
          {children}
        </div>
      ),
      Separator: () => <hr />,
    },
    Modal,
    // Overridden so `input[name=...]` is a stable selector for typing into
    // fields; every other uikit export comes through from `actual`.
    Input: ({ name, value, onChange }: any) => (
      <input name={name} value={value ?? ''} onChange={onChange} />
    ),
  }
})

// Silences React's "not configured to support act(...)" warning. Copied from
// `path-widget.test.tsx:76`.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// FormRenderer calls `getAdminConfig()` unconditionally (`form-renderer.tsx:279`)
// to resolve the path widget's slugifier. The *use* of the result is gated on
// `useAsPath`, but the call is not — with no config registered it throws
// "Byline has not been configured yet" and the mount fails. `AdminConfig`
// requires only `i18n` and `collections`, so register a real one rather than
// mocking `@byline/core`; it lives on a global, so module scope runs it once.
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
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

// FormRenderer also calls `useBylineFieldServices()` unconditionally
// (`form-renderer.tsx:271`), which throws when the provider is absent. Only
// `getCollectionDocuments` and `uploadField` are required members; the tree
// functions are optional. Cast the stub — these tests never invoke it, and
// pinning the real signatures here would couple them to unrelated drift.
const fieldServices = {
  getCollectionDocuments: async () => ({ docs: [], total: 0 }),
  uploadField: async () => ({}),
} as any

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

const renderInProvider = (element: React.ReactNode) => {
  act(() => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider services={fieldServices}>
          {element}
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

import { DocumentActions } from './document-actions'

describe('DocumentActions', () => {
  const render = (props: Record<string, unknown>) =>
    renderInProvider(<DocumentActions {...(props as any)} />)

  it('hides the Delete item when no onDelete handler is supplied', () => {
    render({})
    expect(container.textContent).not.toContain('Delete')
  })

  it('renders the Delete item when an onDelete handler is supplied', () => {
    render({ onDelete: async () => {} })
    expect(container.textContent).toContain('Delete')
  })

  it('renders no trigger at all when no actions are available', () => {
    render({})
    expect(container.querySelector('[data-testid="actions-trigger"]')).toBeNull()
  })

  it('renders the trigger when at least one action is available', () => {
    render({ onDuplicate: async () => {} })
    expect(container.querySelector('[data-testid="actions-trigger"]')).not.toBeNull()
  })
})
