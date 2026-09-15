/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act, useEffect } from 'react'

import type { AdminResourceConfig, Field } from '@byline/core'
import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FormProvider, useFormContext } from '../forms/form-context'
import { FormLayout } from '../forms/form-layout'
import { BylineFieldServicesProvider } from './field-services-context'

// Deliberately not the `;(globalThis as any)` idiom used elsewhere in this
// suite: Biome's import sorting can move an import across that leading
// semicolon, and without semicolons the result parses as a call on the import.
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

const fields: Field[] = [
  // `helpText` makes the uikit control emit a real `help-for-…` element and point
  // `aria-describedby` at it; without it the ARIA assertions have nothing to bite on.
  { name: 'title', label: 'Title', type: 'text', helpText: 'The public title' },
]
const adminConfig = { layout: { main: ['title'] } } as AdminResourceConfig

/**
 * Two groups in ONE form, each declaring a field called `title`. Field names are
 * only unique within their level, so this is where a name-derived id collides
 * without a second form being involved at all.
 */
const nestedFields: Field[] = [
  {
    name: 'intro',
    label: 'Intro',
    type: 'group',
    fields: [{ name: 'title', label: 'Title', type: 'text', helpText: 'Intro title' }],
  } as unknown as Field,
  {
    name: 'outro',
    label: 'Outro',
    type: 'group',
    fields: [{ name: 'title', label: 'Title', type: 'text', helpText: 'Outro title' }],
  } as unknown as Field,
]
const nestedAdminConfig = { layout: { main: ['intro', 'outro'] } } as AdminResourceConfig

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

/**
 * Puts a field into its error state through the real form context, so the widget
 * renders an `error-for-…` element and references it — the same path validation
 * takes.
 */
const ErrorProbe = ({ field }: { field: string }) => {
  const { setFieldError } = useFormContext()
  useEffect(() => {
    setFieldError(field, 'Required')
  }, [field, setFieldError])
  return null
}

/**
 * One form, wrapped in its own `<form>` so the assertions can ask which form an
 * element belongs to — the same question a browser answers when it resolves a
 * label's `for`.
 */
const Form = ({ name }: { name: string }) => (
  <form aria-label={name}>
    <FormProvider initialData={{ fields: {} }} collectionPath="pages">
      <FormLayout
        fields={fields}
        adminConfig={adminConfig}
        activeTabBySet={{}}
        onTabChange={() => {}}
      />
      <ErrorProbe field="title" />
    </FormProvider>
  </form>
)

/**
 * Two forms over the same collection, mounted at once — the shape the relationship
 * picker's creation view produces, and the shape in which a field name is no longer
 * unique in the document.
 */
const renderTwoForms = () => {
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
          <Form name="parent" />
          <Form name="child" />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

describe('field DOM ids across concurrently mounted forms', () => {
  it('gives two mounted forms distinct ids for the same field', () => {
    renderTwoForms()

    const ids = Array.from(container.querySelectorAll('input')).map((node) => node.id)

    expect(ids).toHaveLength(2)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('associates each label with the input in its own form', () => {
    renderTwoForms()

    const labels = Array.from(container.querySelectorAll('label[for]'))
    expect(labels).toHaveLength(2)

    for (const label of labels) {
      const target = document.getElementById(label.getAttribute('for') as string)
      expect(target).not.toBeNull()
      // The browser resolves `for` document-wide, so an unscoped id silently
      // pairs the second form's label with the first form's input.
      expect(target?.closest('form')).toBe(label.closest('form'))
    }
  })

  /**
   * Every id an assistive technology follows has to land in the same form, not
   * just the input's own id: a stale `aria-describedby` announces another form's
   * error text, which is worse than announcing nothing.
   *
   * The earlier version of this test skipped references whose target was missing
   * and rendered no help or error state, so it could pass with nothing exercised
   * and with every association broken. It now requires the references to exist.
   */
  it('keeps every aria reference inside its own form, and resolves all of them', () => {
    renderTwoForms()

    const referencing = Array.from(
      container.querySelectorAll('[aria-describedby], [aria-labelledby]')
    )

    // Both forms are in an error state and both fields carry help text, so there
    // is something to check; an empty list would mean the fixture stopped
    // producing ARIA references and the assertions below became vacuous.
    expect(referencing.length).toBeGreaterThanOrEqual(2)

    let checkedRefs = 0
    for (const node of referencing) {
      const refs = [
        ...(node.getAttribute('aria-describedby') ?? '').split(/\s+/),
        ...(node.getAttribute('aria-labelledby') ?? '').split(/\s+/),
      ].filter(Boolean)

      expect(refs.length).toBeGreaterThan(0)

      for (const ref of refs) {
        const target = document.getElementById(ref)
        // A dangling reference is a defect in its own right: the browser
        // announces nothing, and it is invisible without this assertion.
        expect(target, `dangling aria reference: ${ref}`).not.toBeNull()
        expect(target?.closest('form')).toBe(node.closest('form'))
        checkedRefs += 1
      }
    }

    expect(checkedRefs).toBeGreaterThanOrEqual(2)
  })

  it('renders the error element inside the form whose field is in error', () => {
    renderTwoForms()

    const errors = Array.from(container.querySelectorAll('[id^="error-for-"]'))
    expect(errors).toHaveLength(2)

    const ids = errors.map((node) => node.id)
    expect(new Set(ids).size).toBe(2)

    for (const error of errors) {
      const described = container.querySelector(`[aria-describedby~="${error.id}"]`)
      expect(described).not.toBeNull()
      expect(described?.closest('form')).toBe(error.closest('form'))
    }
  })

  /**
   * The nested case, inside a single form: field names are unique only within
   * their level, so two groups can both declare `title`. A name-derived id
   * collides here with no second form involved.
   */
  it('keeps ids distinct for a repeated field name in two groups of one form', () => {
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
            <form aria-label="single">
              <FormProvider initialData={{ fields: {} }} collectionPath="pages">
                <FormLayout
                  fields={nestedFields}
                  adminConfig={nestedAdminConfig}
                  activeTabBySet={{}}
                  onTabChange={() => {}}
                />
                <ErrorProbe field="intro.title" />
                <ErrorProbe field="outro.title" />
              </FormProvider>
            </form>
          </BylineFieldServicesProvider>
        </I18nProvider>
      )
    })

    const inputIds = Array.from(container.querySelectorAll('input')).map((node) => node.id)
    expect(inputIds).toHaveLength(2)
    expect(new Set(inputIds).size).toBe(2)

    const errorIds = Array.from(container.querySelectorAll('[id^="error-for-"]')).map((n) => n.id)
    expect(errorIds).toHaveLength(2)
    expect(new Set(errorIds).size).toBe(2)

    const allIds = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    expect(allIds.filter((id, index) => allIds.indexOf(id) !== index)).toEqual([])
  })

  it('leaves every id unique across the document', () => {
    renderTwoForms()

    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)

    expect(duplicates).toEqual([])
  })
})
