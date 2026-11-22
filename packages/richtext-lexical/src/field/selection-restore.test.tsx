/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import {
  BylineFieldServicesProvider,
  claimSaveAttempt,
  createEditorViewStateStore,
  type EditorViewStateStore,
  FormRenderer,
  type RichTextSelectionMemory,
  useRichTextSelectionMemory,
} from '@byline/admin/react'
import { defineAdminConfig, type RichTextEditorComponent } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { RichTextField } from '../richtext-field'
import { defaultClientEditorConfig } from './config/default-extensions'
import { installFrameControl } from './test-support/frame-control'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const counters = vi.hoisted(() => ({ pluginRenders: 0 }))

// Counts the selection plugin's renders, so a test can prove an untracked
// form never mounts it.
vi.mock('./selection-restore-plugin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./selection-restore-plugin')>()
  return {
    SelectionRestorePlugin: (props: Parameters<typeof actual.SelectionRestorePlugin>[0]) => {
      counters.pluginRenders++
      return actual.SelectionRestorePlugin(props)
    },
  }
})

/** The field's selection memory, as the editor itself sees it. */
const probe: { memory: RichTextSelectionMemory | null } = { memory: null }

const TestEditor: RichTextEditorComponent = (props) => {
  probe.memory = useRichTextSelectionMemory(props.path ?? props.field.name)
  return <RichTextField {...props} editorConfig={defaultClientEditorConfig} />
}

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
  fields: { richText: { editor: TestEditor } },
})

const fields = [
  { name: 'title', label: 'Title', type: 'text' as const, optional: true },
  { name: 'body', label: 'Body', type: 'richText' as const, optional: true },
]

const text = (value: string) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})
const block = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  children,
  direction: null,
  format: '',
  indent: 0,
  type,
  version: 1,
  textFormat: 0,
  textStyle: '',
  ...extra,
})
const content = (...children: unknown[]): any => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})
const paragraph = (value: string) => block('paragraph', [text(value)])
const doc = (revision: number, body: SerializedEditorState, versionId = `v${revision}`) => ({
  id: 'doc',
  versionId,
  revision,
  status: 'draft',
  fields: { title: 'Title', body },
})

// jsdom lays nothing out, and implements no range geometry at all; Lexical
// measures the caret to scroll it into view.
Range.prototype.getBoundingClientRect ??= () =>
  DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 })
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList

// The field loads the editor with React `lazy()`. Importing it once here
// keeps the cold import out of the renders; `render` still awaits the lazy
// boundary and fails loudly if the editor did not mount.
beforeAll(async () => {
  await import('./editor-component')
})

let frames: ReturnType<typeof installFrameControl>
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  frames = installFrameControl()
  probe.memory = null
  counters.pluginRenders = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  frames.restore()
  vi.restoreAllMocks()
})

/** Renders the form, waits for the lazy editor to mount and settle, and returns its root. */
const render = async (
  store: EditorViewStateStore | null,
  data: Record<string, unknown>,
  onSubmit: () => Promise<void>
): Promise<HTMLElement> => {
  await act(async () => {
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
            } as never
          }
        >
          <FormRenderer
            mode="edit"
            fields={fields as never}
            initialLocale="en"
            initialData={data}
            collectionPath="pages"
            viewState={store}
            onSubmit={onSubmit}
            onCancel={() => {}}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
    // Resolve the lazy boundary inside the same act, so React commits the
    // editor before act returns.
    await import('./editor-component')
  })
  const element = editorRoot()
  if (element == null) throw new Error('rich-text editor did not mount')
  await act(async () => {
    await frames.settleBaseline()
  })
  return element
}

/** The root editor's content-editable element; nested editors sit inside it. */
const editorRoot = () =>
  container
    .querySelector('[data-byline-target="body"]')
    ?.querySelector<HTMLElement>('[contenteditable]') ?? null

const editorOf = (element: HTMLElement | null): LexicalEditor => {
  const editor = (element as any)?.__lexicalEditor as LexicalEditor | undefined
  if (editor == null) throw new Error('editor not mounted')
  return editor
}

const saveButton = () => {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (button == null) throw new Error('save button not found')
  return button
}

/** A host-shaped submit: claims the attempt and records the receipt's revision. */
const hostSubmit = (store: EditorViewStateStore, revision: number) =>
  vi.fn(async () => {
    claimSaveAttempt(store).expectRefresh({ revision })
  })

const clickSave = async () => {
  act(() => saveButton().focus())
  await act(async () => {
    saveButton().click()
  })
}

/** Emissions are deferred through idle callbacks; deliver them. */
const flushEmission = async () => {
  await act(async () => {
    frames.flushIdle()
  })
}

/**
 * An edit as the browser delivers it: a `beforeinput` the form records the
 * working target from, then the editor's own update.
 */
const edit = async (element: HTMLElement, update: () => void) => {
  await act(async () => {
    element.focus()
    element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }))
    editorOf(element).update(update, { discrete: true })
  })
  await flushEmission()
}

/** Puts the caret at `offset` in the first text node and types `value` there. */
const insertAt = (offset: number, value: string) => () => {
  const first = $getRoot().getFirstDescendant()
  if (!$isTextNode(first)) throw new Error('no text node')
  first.select(offset, offset)
  const selection = $getSelection()
  if ($isRangeSelection(selection)) selection.insertText(value)
}

/** The root editor's collapsed caret as [text, offset], or null without one. */
const caretOf = (editor: LexicalEditor): [string, number] | null =>
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
    return [selection.anchor.getNode().getTextContent(), selection.anchor.offset]
  })

/**
 * The ordinary flow: types "," after "Hello", which leaves the caret there,
 * delivers the deferred change, and saves with no further selection update.
 * A later caret move would recreate a selection that a faulty deferred
 * callback had erased, and hide the fault.
 */
const typeAndSave = async (
  store: EditorViewStateStore,
  onSubmit: () => Promise<void>
): Promise<HTMLElement> => {
  const element = await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
  await edit(element, insertAt(5, ','))
  expect(saveButton().disabled).toBe(false)
  await clickSave()
  expect(onSubmit).toHaveBeenCalledTimes(1)
  return element
}

// Smoke tests: they check that the form, the view-state store, the field's
// selection memory and the editor are connected. jsdom has no layout, focus
// model or native selection, so where the caret and focus actually land is
// verified by hand in a browser; the unchanged-content rule itself is covered
// by `content-fingerprint.test.node.ts`.
describe('rich-text caret restoration wiring', () => {
  it('a successful save of unchanged content hands the caret to the reloaded editor without dirtying the form', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    const before = await typeAndSave(store, onSubmit)

    const after = await render(store, doc(2, content(paragraph('Hello, world'))), onSubmit)
    await flushEmission()
    expect(after).not.toBe(before)
    expect(caretOf(editorOf(after))).toEqual(['Hello, world', 6])
    // The caret is view state: no patch, no dirty form.
    expect(saveButton().disabled).toBe(true)
  })

  it('content changed by the server: the reloaded editor gets no caret', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await typeAndSave(store, onSubmit)

    const after = await render(store, doc(2, content(paragraph('Hello, world!'))), onSubmit)
    expect(caretOf(editorOf(after))).toBeNull()
  })

  it('a failed save grants no caret and leaves the form dirty', async () => {
    const store = createEditorViewStateStore()
    const grantSelection = vi.spyOn(store, 'grantSelection')
    const onSubmit = vi.fn(async () => {
      throw new Error('save failed')
    })
    await typeAndSave(store, onSubmit)
    expect(saveButton().disabled).toBe(false)
    expect(grantSelection).not.toHaveBeenCalled()
    expect(probe.memory?.take()).toBeNull()
  })

  it('a form without a view-state store mounts no selection tracking', async () => {
    const element = await render(null, doc(1, content(paragraph('Hello world'))), async () => {})
    await edit(element, insertAt(5, ','))
    expect(probe.memory).toBeNull()
    expect(counters.pluginRenders).toBe(0)
  })
})
