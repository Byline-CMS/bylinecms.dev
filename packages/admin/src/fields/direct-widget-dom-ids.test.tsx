/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import type { Field } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FormProvider } from '../forms/form-context'
import { CheckboxField } from './checkbox/checkbox-field'
import { DateTimeField } from './datetime/datetime-field'
import { TextField } from './text/text-field'

const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

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
 * These widgets are re-exported from `@byline/admin/react`, so a host can compose
 * them directly rather than through `FieldRenderer`. Going through `FieldRenderer`
 * would hand them an already-scoped `id` and prove nothing about their own
 * fallback, which is the path a direct consumer takes.
 */
const renderDirect = (node: (formName: string) => React.ReactNode) => {
  act(() => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        {['parent', 'child'].map((formName) => (
          <form aria-label={formName} key={formName}>
            <FormProvider initialData={{ fields: {} }} collectionPath="pages">
              {node(formName)}
            </FormProvider>
          </form>
        ))}
      </I18nProvider>
    )
  })
}

const controlIds = (selector: string) =>
  Array.from(container.querySelectorAll(selector)).map((node) => node.id)

describe('widgets composed directly under two form providers', () => {
  it('gives a text field distinct ids without FieldRenderer supplying one', () => {
    const field = { name: 'title', label: 'Title', type: 'text' } as Field
    renderDirect(() => <TextField field={field as any} />)

    const ids = controlIds('input')
    expect(ids).toHaveLength(2)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('gives a checkbox distinct ids', () => {
    const field = { name: 'featured', label: 'Featured', type: 'checkbox' } as Field
    renderDirect(() => <CheckboxField field={field as any} />)

    const ids = Array.from(container.querySelectorAll('[role="checkbox"], input[type="checkbox"]'))
      .map((node) => node.id)
      .filter((id) => id !== '')

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('gives a datetime control distinct ids on the control itself', () => {
    const field = { name: 'publishedOn', label: 'Published on', type: 'datetime' } as Field
    renderDirect(() => <DateTimeField field={field as any} />)

    // The scoped id must reach the control the label points at, not only the
    // error element — the first revision scoped the error and left the input.
    const ids = controlIds('input').filter((id) => id !== '')
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('associates each directly composed label with the control in its own form', () => {
    const field = { name: 'title', label: 'Title', type: 'text' } as Field
    renderDirect(() => <TextField field={field as any} />)

    const labels = Array.from(container.querySelectorAll('label[for]'))
    expect(labels.length).toBeGreaterThanOrEqual(2)

    for (const label of labels) {
      const target = document.getElementById(label.getAttribute('for') as string)
      expect(target).not.toBeNull()
      expect(target?.closest('form')).toBe(label.closest('form'))
    }
  })

  /**
   * An explicit id belongs to the caller: it may already be referenced from
   * outside the form, and scoping it would break that reference. Two forms given
   * the same explicit id therefore still collide — that is the caller's choice,
   * and the test records it as intended rather than accidental.
   */
  it('passes a caller-supplied id through unchanged in every direct widget', () => {
    const text = { name: 'title', label: 'Title', type: 'text' } as Field
    renderDirect(() => <TextField field={text as any} id="explicit-text" />)
    expect(controlIds('input')).toEqual(['explicit-text', 'explicit-text'])

    const checkbox = { name: 'featured', label: 'Featured', type: 'checkbox' } as Field
    renderDirect(() => <CheckboxField field={checkbox as any} id="explicit-checkbox" />)
    expect(
      Array.from(container.querySelectorAll('[id="explicit-checkbox"]')).length
    ).toBeGreaterThanOrEqual(2)

    const datetime = { name: 'publishedOn', label: 'On', type: 'datetime' } as Field
    renderDirect(() => <DateTimeField field={datetime as any} id="explicit-datetime" />)
    expect(
      Array.from(container.querySelectorAll('[id="explicit-datetime"]')).length
    ).toBeGreaterThanOrEqual(2)
  })
})
