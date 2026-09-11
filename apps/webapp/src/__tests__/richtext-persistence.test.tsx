/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * What a form actually SUBMITS when a richtext field's stored content
 * was adapted to the field's capabilities.
 *
 * Suppressing `onChange` during normalization is necessary but does not
 * establish safe persistence, so every assertion here is on the
 * submitted patches — never on editor state. These live in the app
 * rather than in `@byline/admin` because only the app has both the form
 * machinery and the Lexical editor: `@byline/admin` does not depend on
 * `@byline/richtext-lexical`, the dependency runs the other way.
 */

import { act } from 'react'

import { BylineFieldServicesProvider, FormRenderer } from '@byline/admin/react'
import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
      Trigger: ({ children }: any) => <div>{children}</div>,
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
    Input: ({ id, name, value, onChange, disabled }: React.ComponentProps<'input'>) => (
      <input id={id} name={name} disabled={disabled} value={value ?? ''} onChange={onChange} />
    ),
  }
})

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

/** A field configured without headings — the FORRU-shaped case. */
const headinglessEditor = lexicalEditor((config) => {
  config.extensions.remove(builtInExtensions.Heading)
  return config
})

const fields = [
  { name: 'title', label: 'Title', type: 'text' as const },
  { name: 'body', label: 'Body', type: 'richText' as const },
]

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [{ path: 'pages', labels: { singular: 'Page', plural: 'Pages' }, fields }],
  fields: { richText: { editor: headinglessEditor } },
} as any)

const text = (value: string) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})
const doc = (...children: unknown[]): any => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})
const CURRENT_BODY = doc({
  children: [text('Current body')],
  direction: null,
  format: '',
  indent: 0,
  type: 'paragraph',
  version: 1,
})
const SAVED_WITH_HEADING = doc({
  children: [text('Legacy title')],
  direction: null,
  format: '',
  indent: 0,
  type: 'heading',
  version: 1,
  tag: 'h1',
})

const fieldServices = {
  getCollectionDocuments: async () => ({ docs: [], total: 0 }),
  uploadField: async () => ({}),
} as any

let container: HTMLDivElement
let root: Root
let frameCallbacks: FrameRequestCallback[] = []
let originalRaf: typeof requestAnimationFrame

beforeEach(() => {
  // Drive frames explicitly rather than waiting for jsdom's timer-based
  // ones, so the baseline settles when the test says so.
  frameCallbacks = []
  originalRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frameCallbacks.push(callback)
    return frameCallbacks.length
  }) as typeof requestAnimationFrame

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  globalThis.requestAnimationFrame = originalRaf
})

/**
 * Render the form for one document version.
 *
 * `versionId` keys the FormRenderer because `FormProvider` captures
 * `initialData.fields` in a ref on mount — changing the prop alone never
 * reaches the form. The real edit route gets the same effect from a
 * route remount when a restore navigates, so keying here exercises that
 * path rather than a fiction.
 */
async function renderForm(
  onSubmit: (payload: any) => void,
  value: any,
  versionId = 'v1'
): Promise<void> {
  await act(async () => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider services={fieldServices}>
          <FormRenderer
            key={versionId}
            mode="edit"
            fields={fields}
            collectionPath="pages"
            // Fields live under `initialData.fields` — FormRenderer reads
            // `initialData?.fields?.[field.name]` for each default value.
            initialData={{ id: 'doc-1', versionId, fields: { title: 'A title', body: value } }}
            onSubmit={onSubmit}
            onCancel={() => {}}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
  await waitForEditor()
}

/**
 * Wait for the editor to mount, then settle its baseline.
 *
 * Two different waits, deliberately. `EditorField` is lazy behind
 * Suspense, so the mount genuinely depends on a dynamic import
 * resolving — that one is polled, and fails loudly rather than
 * continuing against a form with no editor in it.
 *
 * The baseline is not a wait at all. `ApplyValuePlugin` captures it
 * after a microtask and two animation frames, so the frames are driven
 * directly rather than slept through: a fixed delay would be guessing at
 * a sequence the test can simply perform.
 */
async function waitForEditor(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (container.querySelector('[contenteditable="true"]') != null) break
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  if (container.querySelector('[contenteditable="true"]') == null) {
    throw new Error(`editor never mounted; form rendered: ${container.textContent?.slice(0, 200)}`)
  }
  await settleBaseline()
}

/**
 * Run the microtask and two animation frames `ApplyValuePlugin` defers
 * its baseline capture through. Mirrors the sequence in
 * `apply-value-plugin.tsx`; if that changes, this is the other half.
 */
async function settleBaseline(): Promise<void> {
  await act(async () => {
    for (let generation = 0; generation < 2; generation++) {
      await Promise.resolve()
      for (const callback of frameCallbacks.splice(0)) callback(performance.now())
    }
    await Promise.resolve()
  })
}

/** The Lexical editor mounted inside the form, via its root element. */
function formEditor(): any {
  const root = container.querySelector('[contenteditable="true"]')
  if (root == null) throw new Error('editor root not found — did the lazy component resolve?')
  const editor = (root as any).__lexicalEditor
  if (editor == null) throw new Error('no editor attached to the contenteditable')
  return editor
}

/** Assert the stored heading was adapted and is visible before anything is submitted. */
function expectAdapted(): void {
  expect(container.querySelector('.byline-richtext-notice--adapted')).not.toBeNull()
  expect(container.textContent).toContain('Legacy title')
}

const typeIntoTitle = async (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[name="title"]')
  if (input == null) throw new Error('title input not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submitForm = async () => {
  const form = container.querySelector('form')
  if (form == null) throw new Error('form not found')
  await act(async () => {
    form.requestSubmit()
  })
}

const bodyPatches = (payload: any) =>
  (payload?.patches ?? []).filter((patch: { path?: string }) => patch.path?.startsWith('body'))

describe('persistence of adapted richtext content', () => {
  it('opening a document adapts it, submits no richtext patch, and stays clean', async () => {
    const onSubmit = vi.fn()
    await renderForm(onSubmit, SAVED_WITH_HEADING)

    // Establish that adaptation actually happened before asserting on
    // what a submit produces — otherwise an empty patch list proves
    // nothing about adapted content.
    expectAdapted()
    // Nothing is submitted until a submit is explicitly requested.
    expect(onSubmit).not.toHaveBeenCalled()

    await submitForm()

    const payload = onSubmit.mock.calls[0]?.[0]
    expect(payload).toBeDefined()
    // Opening must never rewrite storage: the adaptation is
    // presentational until the reader edits the field.
    expect(payload.patches).toEqual([])
    expect(payload.contentDirty).toBe(false)
  })

  it('saving an unrelated field emits no richtext patch', async () => {
    const onSubmit = vi.fn()
    await renderForm(onSubmit, SAVED_WITH_HEADING)
    expectAdapted()

    await typeIntoTitle('A title, edited')
    await submitForm()

    const payload = onSubmit.mock.calls[0]?.[0]
    expect(payload).toBeDefined()
    expect(bodyPatches(payload)).toEqual([])
    const titlePatches = (payload.patches ?? []).filter((patch: { path?: string }) =>
      patch.path?.startsWith('title')
    )
    expect(titlePatches.length).toBeGreaterThan(0)
  })

  it('editing the adapted field submits the adapted value with the edit intact', async () => {
    const onSubmit = vi.fn()
    await renderForm(onSubmit, SAVED_WITH_HEADING)
    expectAdapted()

    await act(async () => {
      formEditor().update(
        () => {
          $getRoot().append($createParagraphNode().append($createTextNode('and more')))
        },
        { discrete: true }
      )
    })
    await settleBaseline()

    await submitForm()

    const payload = onSubmit.mock.calls[0]?.[0]
    expect(payload).toBeDefined()
    const patches = bodyPatches(payload)
    expect(patches.length).toBeGreaterThan(0)

    const submitted = JSON.stringify(patches)
    // The adaptation persists once edited — that is the loss the notice
    // warns about. What must NOT happen is losing the original text or
    // the edit.
    expect(submitted).not.toContain('"type":"heading"')
    expect(submitted).toContain('Legacy title')
    expect(submitted).toContain('and more')
  })

  it('restoring an older version adapts it and still submits no richtext patch', async () => {
    const onSubmit = vi.fn()
    // A clean current version first.
    await renderForm(onSubmit, CURRENT_BODY, 'v2')
    expect(container.querySelector('.byline-richtext-notice--adapted')).toBeNull()
    expect(container.textContent).toContain('Current body')

    // Restoring navigates, which remounts the form with the older
    // version's data.
    await renderForm(onSubmit, SAVED_WITH_HEADING, 'v1')
    expectAdapted()
    expect(onSubmit).not.toHaveBeenCalled()

    await submitForm()

    const payload = onSubmit.mock.calls[0]?.[0]
    // A successful submission, not one swallowed by validation.
    expect(payload).toBeDefined()
    expect(bodyPatches(payload)).toEqual([])
    expect(payload.contentDirty).toBe(false)
  })
})
