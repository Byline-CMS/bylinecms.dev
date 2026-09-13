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
    Input: ({ name, value, onChange, readOnly }: any) => (
      <input name={name} value={value ?? ''} onChange={onChange} readOnly={readOnly ?? false} />
    ),
  }
})

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
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

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

import { FormRenderer } from './form-renderer'

const baseProps = {
  mode: 'edit' as const,
  fields: [{ name: 'title', label: 'Title', type: 'text' as const }],
  onSubmit: () => {},
  onCancel: () => {},
  collectionPath: 'pages',
  initialData: { id: 'doc-1', path: 'about-us', fields: { title: 'About' } },
}

describe('FormRenderer capabilities', () => {
  const render = (props: Record<string, unknown>) =>
    renderInProvider(<FormRenderer {...(props as any)} />)

  it('renders the path widget by default when initialData carries a path', () => {
    render(baseProps)
    const widget = container.querySelector('.byline-form-path')
    expect(widget).not.toBeNull()
    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.value).toBe('about-us')
  })

  it('forwards adminConfig.lockPath to the path widget', () => {
    render({ ...baseProps, adminConfig: { slug: 'pages', lockPath: true } })

    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(true)
    expect(input?.value).toBe('about-us')
  })

  it('leaves the path widget editable when no lockPath is declared', () => {
    render({ ...baseProps, adminConfig: { slug: 'pages' } })

    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(false)
  })

  it('keeps a counter source suppressing Regenerate without locking the input', () => {
    // `sourceLocked` and `lockPath` stay independent: a counter-sourced path
    // still has no derivable preview, but remains editable unless declared.
    // The source needs a real value whose slug ('448') differs from the
    // stored path ('about-us'), or Regenerate would be absent anyway and the
    // assertion would hold even if `sourceLocked` forwarding broke.
    render({
      ...baseProps,
      fields: [{ name: 'ref', label: 'Ref', type: 'counter' as const }],
      useAsPath: 'ref',
      initialData: { id: 'doc-1', path: 'about-us', fields: { ref: 448 } },
      adminConfig: { slug: 'pages' },
    })

    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(false)
    expect(container.querySelector('.byline-form-path-regenerate')).toBeNull()
  })

  it('renders the locked widget on create with no useAsPath and no stored path', () => {
    // A collection whose paths come from an external system declares no
    // `useAsPath` and has nothing stored yet — the case the old render gate
    // hid outright.
    render({
      ...baseProps,
      mode: 'create' as const,
      useAsPath: undefined,
      initialData: { fields: {} },
      adminConfig: { slug: 'pages', lockPath: true },
    })

    expect(container.querySelector('.byline-form-path')).not.toBeNull()
    const input = container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
    expect(input?.readOnly).toBe(true)
    expect(input?.value).toBe('')
  })

  it('keeps the widget hidden on create without useAsPath when unlocked', () => {
    render({
      ...baseProps,
      mode: 'create' as const,
      useAsPath: undefined,
      initialData: { fields: {} },
      adminConfig: { slug: 'pages' },
    })

    expect(container.querySelector('.byline-form-path')).toBeNull()
  })

  it('lets showPath: false override lockPath', () => {
    render({ ...baseProps, showPath: false, adminConfig: { slug: 'pages', lockPath: true } })

    expect(container.querySelector('.byline-form-path')).toBeNull()
  })

  it('suppresses the path widget when showPath is false', () => {
    render({ ...baseProps, showPath: false })
    expect(container.querySelector('.byline-form-path')).toBeNull()
    expect(container.querySelector('input[name="__systemPath__"]')).toBeNull()
  })

  it('uses the heading override verbatim instead of create/edit wording', () => {
    render({
      ...baseProps,
      mode: 'create' as const,
      headingLabel: 'Thing',
      heading: 'Site settings',
    })
    const heading = container.querySelector('h1, h2, h3')
    expect(heading?.textContent?.trim()).toBe('Site settings')
  })

  it('falls back to create wording when no heading override is given', () => {
    render({ ...baseProps, mode: 'create' as const, headingLabel: 'Thing' })
    const heading = container.querySelector('h1, h2, h3')
    expect(heading?.textContent?.trim()).toBe('Create Thing')
  })
})
