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
    Input: ({ name, value, onChange }: any) => (
      <input name={name} value={value ?? ''} onChange={onChange} />
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

const fields = [{ name: 'title', label: 'Title', type: 'text' as const }]

const typeIntoTitle = (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[name="title"]')
  if (input == null) throw new Error('title input not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submitForm = () => {
  const form = container.querySelector('form')
  if (form == null) throw new Error('form not found')
  act(() => {
    form.requestSubmit()
  })
}

const deferred = () => {
  let resolve: () => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('FormRenderer submit contract', () => {
  const render = (props: Record<string, unknown>) =>
    renderInProvider(<FormRenderer {...(props as any)} />)

  const baseProps = {
    mode: 'create' as const,
    fields,
    onCancel: () => {},
    collectionPath: 'pages',
  }

  it('becomes dirty once a field is edited', () => {
    render({ ...baseProps, onSubmit: async () => {} })
    expect(container.textContent).toContain('Close')
    typeIntoTitle('Hello')
    expect(container.textContent).toContain('Cancel')
  })

  it('clears dirty state when onSubmit resolves', async () => {
    const onSubmit = vi.fn(async () => {})
    render({ ...baseProps, onSubmit })
    typeIntoTitle('Hello')
    submitForm()
    await act(async () => {})
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Close')
  })

  it('preserves dirty state when onSubmit rejects', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('save failed')
    })
    render({ ...baseProps, onSubmit })
    typeIntoTitle('Hello')
    submitForm()
    await act(async () => {})
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Cancel')
  })

  it('shows a named busy indicator until onSubmit resolves', async () => {
    const submission = deferred()
    render({ ...baseProps, onSubmit: () => submission.promise })
    typeIntoTitle('Hello')
    submitForm()
    await act(async () => {})

    const form = container.querySelector('form')
    const busyRegion = form?.parentElement
    const liveStatus = container.querySelector('[role="status"]')
    const saveButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(busyRegion?.getAttribute('aria-busy')).toBe('true')
    expect(form?.getAttribute('aria-busy')).toBeNull()
    expect(form?.hasAttribute('inert')).toBe(true)
    expect(liveStatus?.textContent).toBe('Saving…')
    expect(busyRegion?.contains(liveStatus)).toBe(false)
    expect(saveButton?.getAttribute('aria-label')).toBe('Save')
    expect(saveButton?.querySelector('.byline-loader-ellipsis')).not.toBeNull()
    expect(saveButton?.querySelector('.byline-form-save-label')?.textContent).toBe('Save')

    await act(async () => {
      submission.resolve()
      await submission.promise
    })

    expect(busyRegion?.getAttribute('aria-busy')).toBe('false')
    expect(form?.hasAttribute('inert')).toBe(false)
    expect(liveStatus?.textContent).toBe('')
    expect(saveButton?.getAttribute('aria-label')).toBeNull()
    expect(saveButton?.querySelector('.byline-loader-ellipsis')).toBeNull()
  })

  it('hides the busy indicator when onSubmit rejects', async () => {
    const submission = deferred()
    render({ ...baseProps, onSubmit: () => submission.promise })
    typeIntoTitle('Hello')
    submitForm()
    await act(async () => {})

    const form = container.querySelector('form')
    const busyRegion = form?.parentElement
    const saveButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(busyRegion?.getAttribute('aria-busy')).toBe('true')
    expect(form?.getAttribute('aria-busy')).toBeNull()
    expect(saveButton?.querySelector('.byline-loader-ellipsis')).not.toBeNull()

    await act(async () => {
      submission.reject(new Error('save failed'))
      try {
        await submission.promise
      } catch {
        // FormRenderer intentionally handles host-reported submission failures.
      }
    })

    expect(form?.getAttribute('aria-busy')).toBeNull()
    expect(busyRegion?.getAttribute('aria-busy')).toBe('false')
    expect(form?.hasAttribute('inert')).toBe(false)
    expect(saveButton?.getAttribute('aria-label')).toBeNull()
    expect(saveButton?.querySelector('.byline-loader-ellipsis')).toBeNull()
  })

  it('restores keyboard focus after the inert submitting window closes', async () => {
    const submission = deferred()
    render({ ...baseProps, onSubmit: () => submission.promise })
    typeIntoTitle('Hello')
    const input = container.querySelector<HTMLInputElement>('input[name="title"]')
    if (input == null) throw new Error('title input not found')
    input.focus()
    expect(document.activeElement).toBe(input)

    submitForm()
    await act(async () => {})

    document.body.tabIndex = -1
    document.body.focus()
    expect(document.activeElement).toBe(document.body)

    await act(async () => {
      submission.resolve()
      await submission.promise
    })

    expect(document.activeElement).toBe(input)
    document.body.removeAttribute('tabindex')
  })

  it('ignores a second submit while the first is still in flight', async () => {
    const submission = deferred()
    const onSubmit = vi.fn(async () => {
      await submission.promise
    })
    render({ ...baseProps, onSubmit })
    typeIntoTitle('Hello')
    submitForm()
    submitForm()
    // Submission first awaits the field-hook pipeline, so flush that
    // microtask before counting host calls. An immediate assertion here
    // would observe zero calls and would not test duplicate suppression.
    await act(async () => {})
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => {
      submission.resolve()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
