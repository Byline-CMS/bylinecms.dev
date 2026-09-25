/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The advertised-locales widget and the immediate-save confirmation explain
 * what a checkbox does to public delivery. Rendered with the real English
 * admin bundle, so a renamed or deleted key fails here rather than showing a
 * raw key to an editor.
 */

import { act, type ReactNode } from 'react'

import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@byline/ui/react', () => {
  const Modal = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  Modal.Container = Part
  Modal.Header = Part
  Modal.Content = Part
  Modal.Actions = Part
  return {
    Label: ({ label }: { label?: string }) => <span>{label}</span>,
    HelpText: ({ text }: { text: string }) => <p data-testid="group-hint">{text}</p>,
    Checkbox: ({ id, label, helpText }: { id: string; label: string; helpText?: string }) => (
      <div data-testid={id}>
        <span>{label}</span>
        {helpText ? <span data-testid={`${id}-hint`}>{helpText}</span> : null}
      </div>
    ),
    Modal,
    Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
    IconButton: ({ children }: { children?: ReactNode }) => (
      <button type="button">{children}</button>
    ),
    CloseIcon: () => null,
  }
})

vi.mock('./form-context', () => ({
  useFormContext: () => ({ setSystemAvailableLocales: vi.fn() }),
  useSystemAvailableLocales: () => ['en'],
}))

import { AvailableLocalesWidget } from './available-locales-widget'
import { SystemFieldsConfirmModal } from './form-modals'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const en: Record<string, string> = adminTranslations({ locales: ['en'] }).en?.['byline-admin'] ?? {}

describe('locale visibility copy', () => {
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

  const render = (node: ReactNode) => {
    act(() => {
      root.render(
        <I18nProvider
          bundle={adminTranslations({ locales: ['en'] })}
          activeLocale="en"
          defaultLocale="en"
          localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
        >
          {node}
        </I18nProvider>
      )
    })
  }

  const text = (testId: string) =>
    container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null

  it('explains source availability on the source row only, and delivery for the group', () => {
    render(
      <AvailableLocalesWidget
        contentLocales={[
          { code: 'en', label: 'English' },
          { code: 'es', label: 'Español' },
        ]}
        availableVersionLocales={['en', 'es']}
        sourceLocale="en"
      />
    )

    expect(text('available-locale-en-hint')).toBe(en['availableLocalesWidget.sourceRowHint'])
    expect(text('available-locale-en-hint')).toContain('available while published')
    expect(text('available-locale-es-hint')).toBeNull()
    expect(text('group-hint')).toBe(en['availableLocalesWidget.hint'])
    expect(text('group-hint')).toContain('unpublished draft')
    expect(container.textContent).toContain('whether or not it is checked')
  })

  it('moves the source note with the document source language', () => {
    render(
      <AvailableLocalesWidget
        contentLocales={[
          { code: 'en', label: 'English' },
          { code: 'es', label: 'Español' },
        ]}
        availableVersionLocales={['en', 'es']}
        sourceLocale="es"
      />
    )

    expect(text('available-locale-es-hint')).toBe(en['availableLocalesWidget.sourceRowHint'])
    expect(text('available-locale-en-hint')).toBeNull()
  })

  it('explains immediate public delivery for a locale-only save', () => {
    render(
      <SystemFieldsConfirmModal
        contentDirty={false}
        pathDirty={false}
        availableLocalesDirty={true}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )

    expect(container.textContent).toContain(en['forms.systemFieldsConfirm.bulletLocales'])
    expect(container.textContent).toContain('appears on the public site straight away')
    expect(container.textContent).not.toContain(en['forms.systemFieldsConfirm.localesContentNote'])
  })

  it('explains the save order when locale and content changes are saved together', () => {
    render(
      <SystemFieldsConfirmModal
        contentDirty={true}
        pathDirty={false}
        availableLocalesDirty={true}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )

    const note = en['forms.systemFieldsConfirm.localesContentNote']
    expect(container.textContent).toContain(note)
    // The combined save is one guarded commit: a failed save applies neither.
    expect(note).toContain('saved together')
    expect(note).toContain('neither is applied')
    expect(note).toContain('stays hidden until it is published')
  })

  it('adds no locale note to a combined path and content save', () => {
    render(
      <SystemFieldsConfirmModal
        contentDirty={true}
        pathDirty={true}
        availableLocalesDirty={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )

    expect(container.textContent).not.toContain(en['forms.systemFieldsConfirm.localesContentNote'])
    expect(container.textContent).not.toContain(en['forms.systemFieldsConfirm.bulletLocales'])
  })
})
