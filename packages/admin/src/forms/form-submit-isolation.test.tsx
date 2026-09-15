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
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormRenderer } from './form-renderer'

const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

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

// Optional so submission is not blocked by validation: this file tests which
// form a submit event belongs to, not what the form does with it.
const fields = [{ name: 'title', label: 'Title', type: 'text' as const, optional: true }]

let container: HTMLDivElement
let root: Root
let portalHost: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  portalHost = document.createElement('div')
  document.body.appendChild(portalHost)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  portalHost.remove()
})

/**
 * A nested form rendered through a portal: outside the parent `<form>` in the
 * DOM, so no invalid nested-form markup arises, but still a descendant in the
 * *React* tree — which is what React propagates synthetic events along.
 */
const PortalledInnerForm = ({
  stopPropagation,
  onInnerSubmit,
}: {
  stopPropagation: boolean
  onInnerSubmit: () => void
}) =>
  createPortal(
    <form
      data-testid="inner-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (stopPropagation) event.stopPropagation()
        onInnerSubmit()
      }}
    >
      <input name="innerTitle" defaultValue="" />
      <button type="submit">Save inner</button>
    </form>,
    portalHost
  )

const renderWithInnerForm = ({
  parentSubmit,
  onInnerSubmit = () => {},
  stopPropagation = false,
}: {
  parentSubmit: () => Promise<void>
  onInnerSubmit?: () => void
  stopPropagation?: boolean
}) => {
  act(() => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider services={fieldServices}>
          <FormRenderer
            mode="create"
            fields={fields}
            collectionPath="pages"
            onCancel={() => {}}
            onSubmit={parentSubmit}
            headerSlot={
              <PortalledInnerForm stopPropagation={stopPropagation} onInnerSubmit={onInnerSubmit} />
            }
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const parentForm = () => {
  const form = container.querySelector('form')
  if (form == null) throw new Error('parent form not found')
  return form
}

const innerForm = () => {
  const form = portalHost.querySelector<HTMLFormElement>('[data-testid="inner-form"]')
  if (form == null) throw new Error('inner form not found')
  return form
}

const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('submit isolation across a portal', () => {
  /**
   * The inner form here deliberately does **not** call `stopPropagation`, so
   * these two cases exercise the parent's own guard. With the child-side defence
   * in place as well, a broken parent guard would be invisible.
   */
  it('does not run the parent submit handler when a portalled inner form submits', async () => {
    const parentSubmit = vi.fn(async () => {})
    renderWithInnerForm({ parentSubmit })

    await submit(innerForm())

    expect(parentSubmit).not.toHaveBeenCalled()
  })

  it('still runs the inner form’s own handler', async () => {
    const parentSubmit = vi.fn(async () => {})
    const onInnerSubmit = vi.fn()
    renderWithInnerForm({ parentSubmit, onInnerSubmit })

    await submit(innerForm())

    expect(onInnerSubmit).toHaveBeenCalledTimes(1)
    expect(parentSubmit).not.toHaveBeenCalled()
  })

  it('still submits normally from the parent form itself', async () => {
    const parentSubmit = vi.fn(async () => {})
    renderWithInnerForm({ parentSubmit })

    await submit(parentForm())

    expect(parentSubmit).toHaveBeenCalledTimes(1)
  })

  it('leaves the parent form submitting on repeat after an inner submit', async () => {
    const parentSubmit = vi.fn(async () => {})
    renderWithInnerForm({ parentSubmit })

    await submit(innerForm())
    await submit(parentForm())
    await submit(parentForm())

    expect(parentSubmit).toHaveBeenCalledTimes(2)
  })
})

/**
 * The child-side defence, proved without the parent guard in the picture. If this
 * were asserted against `FormRenderer`, a working parent guard would satisfy it
 * whether or not the child stopped propagation, and the test would prove nothing
 * about the child.
 */
describe('the child-side stopPropagation defence', () => {
  const PlainParent = ({
    onParentSubmit,
    stopPropagation,
  }: {
    onParentSubmit: () => void
    stopPropagation: boolean
  }) => (
    <form
      data-testid="plain-parent"
      onSubmit={(event) => {
        event.preventDefault()
        onParentSubmit()
      }}
    >
      <PortalledInnerForm stopPropagation={stopPropagation} onInnerSubmit={() => {}} />
    </form>
  )

  const renderPlain = (props: { onParentSubmit: () => void; stopPropagation: boolean }) => {
    act(() => {
      root.render(<PlainParent {...props} />)
    })
  }

  it('keeps an unguarded parent handler from running when the child stops propagation', async () => {
    const onParentSubmit = vi.fn()
    renderPlain({ onParentSubmit, stopPropagation: true })

    await submit(innerForm())

    expect(onParentSubmit).not.toHaveBeenCalled()
  })

  /**
   * The control: the same unguarded parent, with the child defence removed. It
   * fails in exactly the way the feature is meant to prevent, which is what makes
   * the assertion above meaningful.
   */
  it('runs an unguarded parent handler when the child does not stop propagation', async () => {
    const onParentSubmit = vi.fn()
    renderPlain({ onParentSubmit, stopPropagation: false })

    await submit(innerForm())

    expect(onParentSubmit).toHaveBeenCalledTimes(1)
  })
})
