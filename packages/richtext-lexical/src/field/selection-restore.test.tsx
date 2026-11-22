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
  $createNodeSelection,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RichTextField } from '../richtext-field'
import { builtInExtensions } from './config/built-in-extension-names'
import { defaultClientEditorConfig } from './config/default-extensions'
import { installFrameControl } from './test-support/frame-control'
import type { EditorConfig } from './config/types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const counters = vi.hoisted(() => ({ pluginRenders: 0, hashes: 0 }))

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

// Counts content hashing, so a test can prove a caret move hashes nothing.
vi.mock('./utils/hashSerializedState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/hashSerializedState')>()
  return {
    hashSerializedState: (...args: Parameters<typeof actual.hashSerializedState>) => {
      counters.hashes++
      return actual.hashSerializedState(...args)
    },
  }
})

/** The rich-text editor the form renders; each test may narrow its extensions. */
let editorConfig: EditorConfig = defaultClientEditorConfig
/** The field's selection memory, as the editor itself sees it. */
const probe: { memory: RichTextSelectionMemory | null } = { memory: null }

const TestEditor: RichTextEditorComponent = (props) => {
  probe.memory = useRichTextSelectionMemory(props.path ?? props.field.name)
  return <RichTextField {...props} editorConfig={editorConfig} />
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
const captionedImage = (caption: string) =>
  block('paragraph', [
    {
      type: 'inline-image',
      version: 1,
      targetDocumentId: 'doc-1',
      targetCollectionPath: 'media',
      src: '/cat.png',
      position: 'full',
      altText: 'a cat',
      width: 10,
      height: 10,
      showCaption: true,
      caption: { editorState: content(paragraph(caption)) },
    },
  ])

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

let frames: ReturnType<typeof installFrameControl>
let container: HTMLDivElement
let outside: HTMLButtonElement
let root: Root

beforeEach(() => {
  frames = installFrameControl()
  editorConfig = defaultClientEditorConfig
  probe.memory = null
  counters.pluginRenders = 0
  counters.hashes = 0
  container = document.createElement('div')
  outside = document.createElement('button')
  outside.textContent = 'Outside the form'
  document.body.append(container, outside)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  outside.remove()
  frames.restore()
  vi.restoreAllMocks()
})

const render = async (
  store: EditorViewStateStore | null,
  data: Record<string, unknown>,
  onSubmit: () => Promise<void>,
  {
    settle = true,
    fieldList = fields,
    into = root,
    within = container,
  }: {
    settle?: boolean
    fieldList?: readonly unknown[]
    into?: Root
    within?: HTMLElement
  } = {}
) => {
  await act(async () => {
    into.render(
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
            fields={fieldList as never}
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
  })
  // The editor loads lazily; let it mount and settle its baseline.
  const hasBody = fieldList.some((field) => (field as { name?: string }).name === 'body')
  for (let attempt = 0; hasBody && attempt < 20 && editorRoot(within) == null; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
  if (settle) await settleBaseline()
}

const settleBaseline = async () => {
  await act(async () => {
    await frames.settleBaseline()
  })
}

/** The field's focusable wrapper, which carries its target marker. */
const wrapper = () => {
  const element = container.querySelector<HTMLElement>(
    '[data-byline-target="body"][data-byline-role="field"]'
  )
  if (element == null) throw new Error('rich-text wrapper not found')
  return element
}

/** The root editor's content-editable element; nested editors sit inside it. */
const editorRoot = (within: HTMLElement = container) =>
  within
    .querySelector('[data-byline-target="body"]')
    ?.querySelector<HTMLElement>('[contenteditable]') ?? null

const editorOf = (element: HTMLElement | null): LexicalEditor => {
  const editor = (element as any)?.__lexicalEditor as LexicalEditor | undefined
  if (editor == null) throw new Error('editor not mounted')
  return editor
}

/** The inline image's caption editor, once its decorator has rendered. */
const captionRoot = async () => {
  const find = () => container.querySelector<HTMLElement>('.InlineImageNode__contentEditable')
  for (let attempt = 0; attempt < 20 && find() == null; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
  const element = find()
  if (element == null) throw new Error('caption editor not rendered')
  return element
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

/** Moves the caret within the first paragraph's first text node. */
const placeCaret = async (element: HTMLElement, offset: number) => {
  await act(async () => {
    element.focus()
    editorOf(element).update(
      () => {
        const first = $getRoot().getFirstDescendant()
        if (!$isTextNode(first)) throw new Error('no text node')
        first.select(offset, offset)
      },
      { discrete: true }
    )
  })
}

const appendText = (value: string) => () => {
  const first = $getRoot().getFirstDescendant()
  if (!$isTextNode(first)) throw new Error('no text node')
  first.select(first.getTextContentSize(), first.getTextContentSize())
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

const bodyText = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getTextContent())

/** Edits "Hello world" to "Hello world!", leaves the caret after "Hello" and saves. */
const editAndSave = async (store: EditorViewStateStore, onSubmit: () => Promise<void>) => {
  await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
  await edit(editorRoot() as HTMLElement, appendText('!'))
  await placeCaret(editorRoot() as HTMLElement, 5)
  expect(saveButton().disabled).toBe(false)
  await clickSave()
  expect(onSubmit).toHaveBeenCalledTimes(1)
}

describe('restoring the rich-text caret after a save', () => {
  it('caret midway, save, type one character: lands at the saved offset, form clean before typing, dirty after', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)
    const before = editorRoot()

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit)
    await flushEmission()
    const after = editorRoot() as HTMLElement
    expect(after).not.toBe(before)
    const editor = editorOf(after)
    expect(document.activeElement).toBe(after)
    expect(caretOf(editor)).toEqual(['Hello world!', 5])
    // The caret is view state: no patch, no dirty form.
    expect(saveButton().disabled).toBe(true)
    expect(container.textContent).toContain('Close')

    await edit(after, () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertText('X')
    })
    expect(bodyText(editor)).toBe('HelloX world!')
    expect(saveButton().disabled).toBe(false)
  })

  it('changed content: no caret placed, field wrapper focused', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    // A hook on the server changed the text.
    await render(store, doc(2, content(paragraph('Hello world!!'))), onSubmit)
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })

  it('adapted or refused content: no caret placed', async () => {
    // The field no longer accepts headings or inline images.
    const extensions = defaultClientEditorConfig.extensions?.clone()
    extensions?.remove(builtInExtensions.Heading)
    extensions?.remove(builtInExtensions.InlineImage)
    editorConfig = { ...defaultClientEditorConfig, extensions }

    // Adapted: a stored heading loads as a paragraph with the same text.
    const adapted = createEditorViewStateStore()
    const adaptedSubmit = hostSubmit(adapted, 2)
    await editAndSave(adapted, adaptedSubmit)
    await render(
      adapted,
      doc(2, content(block('heading', [text('Hello world!')], { tag: 'h1' }))),
      adaptedSubmit
    )
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()

    // Refused: an inline image cannot be converted, so nothing is applied.
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    const refused = createEditorViewStateStore()
    const refusedSubmit = hostSubmit(refused, 2)
    await editAndSave(refused, refusedSubmit)
    await render(refused, doc(2, content(captionedImage('A cat'))), refusedSubmit)
    expect(document.activeElement).toBe(wrapper())
    // A refused value renders the notice instead of an editor surface.
    expect(container.querySelector('[data-byline-target="body"] [contenteditable]')).toBeNull()
  })

  it('focus moves before the baseline is ready: no caret, focus not taken back', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    // The reloaded form focuses the field; the editor moves on before the
    // editor's baseline for the reloaded value settles.
    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit, { settle: false })
    expect(document.activeElement).toBe(wrapper())
    act(() => outside.focus())
    await settleBaseline()
    await act(async () => {
      await frames.flushFrames(3)
    })
    expect(document.activeElement).toBe(outside)
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })

  it('a key press before the baseline is ready: no caret, the wrapper keeps focus', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit, { settle: false })
    act(() => {
      wrapper().dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    })
    await settleBaseline()
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })

  it('a baseline later than the bound: no caret, the wrapper keeps focus', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit, { settle: false })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1050))
    })
    await settleBaseline()
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })

  it('nested caption selection is not recorded', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(store, doc(1, content(captionedImage('A cat'))), onSubmit)
    await edit(await captionRoot(), appendText('!'))
    await placeCaret(await captionRoot(), 2)
    await clickSave()

    await render(store, doc(2, content(captionedImage('A cat!'))), onSubmit)
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })

  it('edit the root paragraph, then edit a nested caption, then save: no caret replayed, wrapper focused', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    const start = content(paragraph('Hello world'), captionedImage('A cat'))
    await render(store, doc(1, start), onSubmit)
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    // The caption edits record the same field path as the working target.
    // They cancel out, so the saved content still matches the content the
    // root selection was recorded with: only the nested edit may stop it.
    const caption = await captionRoot()
    await edit(caption, appendText('!'))
    await edit(caption, () => {
      const first = $getRoot().getFirstDescendant()
      if (!$isTextNode(first)) throw new Error('no caption text')
      first.setTextContent(first.getTextContent().slice(0, -1))
      first.selectEnd()
    })
    expect(
      editorOf(caption)
        .getEditorState()
        .read(() => $getRoot().getTextContent())
    ).toBe('A cat')
    await clickSave()

    const saved = editorOf(editorRoot()).getEditorState().toJSON()
    await render(store, doc(2, saved), onSubmit)
    expect(document.activeElement).toBe(wrapper())
    const caret = caretOf(editorOf(editorRoot()))
    expect(caret).toBeNull()
  })

  it('no pending successful save: take() returns null and no caret is placed', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = vi.fn(async () => {
      throw new Error('save failed')
    })
    await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    expect(probe.memory?.take()).toBeNull()
    await clickSave()
    expect(probe.memory?.take()).toBeNull()

    // A reload of the same content settles a new baseline without a save.
    act(() => outside.focus())
    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit)
    expect(probe.memory?.take()).toBeNull()
    expect(document.activeElement).toBe(outside)
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })
})

/** Puts the caret at `offset` in the first text node and types `value` there. */
const insertAt = (offset: number, value: string) => () => {
  const first = $getRoot().getFirstDescendant()
  if (!$isTextNode(first)) throw new Error('no text node')
  first.select(offset, offset)
  const selection = $getSelection()
  if ($isRangeSelection(selection)) selection.insertText(value)
}

const typeHere = (value: string) => () => {
  const selection = $getSelection()
  if ($isRangeSelection(selection)) selection.insertText(value)
}

/** A copy of saved content whose inline images carry a refreshed media payload. */
const withRefreshedImages = (state: any): any =>
  JSON.parse(JSON.stringify(state), (key, value) =>
    value && typeof value === 'object' && value.type === 'inline-image' && key !== 'caption'
      ? {
          ...value,
          // Only what the embed walker rewrites: the preview and the copied
          // media values in the relation envelope.
          src: '/cat-refreshed.png',
          width: 20,
          height: 20,
          document: { ...value.document, title: 'Cat (renamed)', altText: 'a refreshed cat' },
        }
      : value
  )

describe('fix round 1: the caret survives the ordinary flow', () => {
  it('type, then Save without moving the caret: the caret comes back where typing left it, and the next character lands there', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(
      store,
      doc(1, content(paragraph('Hello world'), captionedImage('A cat'))),
      onSubmit
    )
    // The emission (and the field's change callback) is idle-deferred and
    // lands after the selection was recorded.
    await edit(editorRoot() as HTMLElement, insertAt(5, 'Q'))
    expect(saveButton().disabled).toBe(false)
    await clickSave()

    // The server refreshes the image's media payload on save; the text and
    // structure the caret depends on are unchanged.
    const saved = withRefreshedImages(editorOf(editorRoot()).getEditorState().toJSON())
    await render(store, doc(2, saved), onSubmit)
    await flushEmission()
    const editor = editorOf(editorRoot())
    expect(document.activeElement).toBe(editorRoot())
    expect(caretOf(editor)).toEqual(['HelloQ world', 6])
    expect(saveButton().disabled).toBe(true)

    await edit(editorRoot() as HTMLElement, typeHere('Z'))
    expect(editor.getEditorState().read(() => $getRoot().getFirstChild()?.getTextContent())).toBe(
      'HelloQZ world'
    )
    expect(saveButton().disabled).toBe(false)
  })

  it('a paste aimed at a text span inside the root is a root edit, not a nested one', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    const span = editorRoot()?.querySelector('span')
    if (span == null) throw new Error('no text span')
    // Lexical's own paste handling needs a real clipboard; only the
    // event's routing matters here, so it stops at the span.
    span.addEventListener('paste', (event) => event.stopPropagation(), { once: true })
    act(() => {
      span.dispatchEvent(new Event('paste', { bubbles: true }))
    })
    await clickSave()

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit)
    expect(caretOf(editorOf(editorRoot()))).toEqual(['Hello world!', 5])
  })

  it('selecting an image after placing a caret clears that caret', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(
      store,
      doc(1, content(paragraph('Hello world'), captionedImage('A cat'))),
      onSubmit
    )
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    await act(async () => {
      editorOf(editorRoot()).update(
        () => {
          const image = $getRoot()
            .getChildren()
            .flatMap((node) => ('getChildren' in node ? (node as any).getChildren() : []))
            .find((node: unknown) => $isDecoratorNode(node))
          if (image == null) throw new Error('no image')
          const selection = $createNodeSelection()
          selection.add(image.getKey())
          $setSelection(selection)
        },
        { discrete: true }
      )
    })
    await clickSave()

    const saved = editorOf(editorRoot()).getEditorState().toJSON()
    await render(store, doc(2, saved), onSubmit)
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })
})

describe('fix round 1: baseline and grant meet in either order', () => {
  it('baseline first: the refreshed editor settles before the restoration hands on the caret', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    // The new version renders, and its editor settles, while the rendered
    // revision still lags the receipt: the restoration has not run yet.
    await render(store, doc(1, content(paragraph('Hello world!')), 'v2'), onSubmit)
    expect(document.activeElement).not.toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()

    await render(store, doc(2, content(paragraph('Hello world!')), 'v2'), onSubmit)
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.activeElement).toBe(editorRoot())
    expect(caretOf(editorOf(editorRoot()))).toEqual(['Hello world!', 5])
    expect(saveButton().disabled).toBe(true)
  })

  it('grant first: the restoration hands on the caret before the reloaded editor settles', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit, { settle: false })
    expect(document.activeElement).toBe(wrapper())
    await settleBaseline()
    expect(document.activeElement).toBe(editorRoot())
    expect(caretOf(editorOf(editorRoot()))).toEqual(['Hello world!', 5])
  })

  it('a save with no new baseline event: the surviving editor gets its caret back', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)
    const before = editorRoot()

    // Same version, new revision: the form and its editor survive, and the
    // value is the editor's own emission, so no baseline is re-established.
    const saved = editorOf(before).getEditorState().toJSON()
    await render(store, doc(2, saved, 'v1'), onSubmit)
    await act(async () => {
      await Promise.resolve()
    })
    expect(editorRoot()).toBe(before)
    expect(document.activeElement).toBe(editorRoot())
    expect(caretOf(editorOf(editorRoot()))).toEqual(['Hello world!', 5])
    expect(saveButton().disabled).toBe(true)
  })

  it('the wrapper loses focus without another element gaining it: no caret, focus not taken back', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit, { settle: false })
    expect(document.activeElement).toBe(wrapper())
    // A blur raises no focusin anywhere; focus falls to <body>.
    act(() => wrapper().blur())
    expect(document.activeElement).toBe(document.body)
    await settleBaseline()
    expect(document.activeElement).toBe(document.body)
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })
})

describe('final fix: the live selection does not outlive its editor', () => {
  const withoutBody = fields.filter((field) => field.name !== 'body')

  it('the editor unmounts before a save: the detached editor is never serialized and no caret is granted', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    const detached = editorOf(editorRoot())

    // The field disappears (a condition, a tab change) with no replacement.
    await render(store, doc(1, content(paragraph('Hello world'))), onSubmit, {
      fieldList: withoutBody,
    })
    expect(editorRoot()).toBeNull()
    expect(store.getTarget()?.path).toBe('body')

    const getState = vi.spyOn(detached, 'getEditorState')
    const toJSON = vi.spyOn(Object.getPrototypeOf(detached.getEditorState()), 'toJSON')
    getState.mockClear()
    const saveSeq = store.beginSave()
    store.settleSave(saveSeq, 'success')
    expect(getState).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
    expect(store.grantSelection(saveSeq, 'body')).toBeNull()
  })

  it('a selection snapshotted by a successful save survives the old editor unmounting and reaches the new one', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await editAndSave(store, onSubmit)
    const before = editorRoot()

    // The old editor is torn down entirely before the replacement mounts. The
    // refreshed revision has not rendered yet, so the restoration still waits.
    await render(store, doc(1, content(paragraph('Hello world!'))), onSubmit, {
      fieldList: withoutBody,
    })
    expect(editorRoot()).toBeNull()

    await render(store, doc(2, content(paragraph('Hello world!'))), onSubmit)
    await flushEmission()
    const after = editorRoot() as HTMLElement
    expect(after).not.toBe(before)
    expect(document.activeElement).toBe(after)
    expect(caretOf(editorOf(after))).toEqual(['Hello world!', 5])
  })

  it("an older editor's teardown leaves a newer editor's selection in place", async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    const older = editorOf(editorRoot())

    // A second form on the same visit (the replacement, mounted before the
    // old one goes) records its own caret in the same field.
    const second = document.createElement('div')
    document.body.append(second)
    const secondRoot = createRoot(second)
    try {
      await render(store, doc(1, content(paragraph('Hello world'))), onSubmit, {
        into: secondRoot,
        within: second,
      })
      const newer = editorRoot(second) as HTMLElement
      await edit(newer, appendText('?'))
      await placeCaret(newer, 3)

      await act(async () => {
        root.unmount()
      })
      root = createRoot(container)

      const olderState = vi.spyOn(older, 'getEditorState')
      const saveSeq = store.beginSave()
      store.settleSave(saveSeq, 'success')
      expect(olderState).not.toHaveBeenCalled()
      expect(store.grantSelection(saveSeq, 'body')).not.toBeNull()
      expect(store.takeSelection('body')).toMatchObject({
        kind: 'richText',
        sel: { anchor: { offset: 3 }, focus: { offset: 3 } },
      })
    } finally {
      await act(async () => {
        secondRoot.unmount()
      })
      second.remove()
    }
  })
})

describe('fix round 1: selection tracking costs', () => {
  it('an untracked form mounts no selection tracking', async () => {
    await render(null, doc(1, content(paragraph('Hello world'))), async () => {})
    await edit(editorRoot() as HTMLElement, appendText('!'))
    await placeCaret(editorRoot() as HTMLElement, 5)
    expect(probe.memory).toBeNull()
    expect(counters.pluginRenders).toBe(0)
  })

  it('caret moves hash and serialize nothing; the save fingerprints once', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    await render(store, doc(1, content(paragraph('Hello world'))), onSubmit)
    await edit(editorRoot() as HTMLElement, appendText('!'))
    expect(counters.pluginRenders).toBeGreaterThan(0)

    const state = editorOf(editorRoot()).getEditorState()
    const toJSON = vi.spyOn(Object.getPrototypeOf(state), 'toJSON')
    counters.hashes = 0
    for (const offset of [1, 4, 7]) await placeCaret(editorRoot() as HTMLElement, offset)
    await act(async () => {
      await Promise.resolve()
    })
    expect(toJSON).not.toHaveBeenCalled()
    expect(counters.hashes).toBe(0)

    await clickSave()
    expect(counters.hashes).toBe(1)
  })
})

type Json = any

const internalLink = (label: string) =>
  block('link', [text(label)], {
    version: 2,
    attributes: {
      linkType: 'internal',
      targetDocumentId: 'page-1',
      targetCollectionId: 'pages-id',
      targetCollectionPath: 'pages',
      document: { title: 'A page', path: '/pages/a-page' },
    },
  })
const customLink = (label: string, url: string) =>
  block('link', [text(label)], { version: 2, attributes: { linkType: 'custom', url } })
const embedImage = () =>
  block('paragraph', [
    {
      type: 'inline-image',
      version: 1,
      targetDocumentId: 'media-1',
      targetCollectionId: 'media-id',
      targetCollectionPath: 'media',
      document: {
        title: 'Cat',
        altText: 'a cat',
        image: { storageUrl: '/cat.png' },
        focalPoint: 'center',
      },
      src: '/cat.png',
      position: 'full',
      altText: 'an authored cat',
      width: 10,
      height: 10,
      showCaption: true,
      caption: { editorState: content(paragraph('A cat')) },
      link: {
        linkType: 'internal',
        targetDocumentId: 'page-2',
        targetCollectionId: 'pages-id',
        targetCollectionPath: 'pages',
        document: { title: 'Another page', path: '/pages/another' },
      },
    },
  ])
const embedContent = () =>
  content(
    block('paragraph', [
      text('Hello world '),
      internalLink('inside'),
      text(' and '),
      customLink('outside', 'https://example.com/a'),
    ]),
    embedImage()
  )

/** Every node reachable through `children`, depth first. */
function* nodesOf(node: Json): Generator<Json> {
  yield node
  for (const child of node.children ?? []) yield* nodesOf(child)
}
const findNode = (state: Json, predicate: (node: Json) => boolean): Json => {
  const found = [...nodesOf(state.root)].find(predicate)
  if (found == null) throw new Error('fixture node not found')
  return found
}
const imageOf = (state: Json) => findNode(state, (node) => node.type === 'inline-image')
const linkOf = (state: Json, linkType: string) =>
  findNode(state, (node) => node.type === 'link' && node.attributes?.linkType === linkType)

/** Types after "Hello", saves, and reloads what the server returns: `serverCopy` of the save. */
const saveAndReload = async (serverCopy: (saved: Json) => void) => {
  const store = createEditorViewStateStore()
  const onSubmit = hostSubmit(store, 2)
  await render(store, doc(1, embedContent()), onSubmit)
  await edit(editorRoot() as HTMLElement, insertAt(5, 'Q'))
  await clickSave()
  const saved: Json = JSON.parse(JSON.stringify(editorOf(editorRoot()).getEditorState().toJSON()))
  serverCopy(saved)
  await render(store, doc(2, saved), onSubmit)
}

describe('fix round 2: the content rule', () => {
  it.each([
    ['plain unchanged content', () => {}],
    [
      'the same embeds with only server-refreshed metadata',
      (saved: Json) => {
        const image = imageOf(saved)
        image.src = '/media/cat-tablet.webp'
        image.width = 768
        image.height = 512
        image.document = {
          ...image.document,
          title: 'Cat, renamed',
          altText: 'a cat, refreshed',
          image: { storageUrl: '/media/cat.webp' },
          sizes: [{ name: 'tablet', url: '/media/cat-tablet.webp' }],
        }
        image.link.document = { title: 'Another page, renamed', path: '/pages/moved' }
        linkOf(saved, 'internal').attributes.document = {
          title: 'A page, renamed',
          path: '/pages/renamed',
        }
      },
    ],
  ])('%s: the caret is placed', async (_name, serverCopy) => {
    await saveAndReload(serverCopy)
    expect(document.activeElement).toBe(editorRoot())
    expect(caretOf(editorOf(editorRoot()))).toEqual(['HelloQ world ', 6])
    expect(saveButton().disabled).toBe(true)
  })

  it.each([
    [
      'a link URL change',
      (saved: Json) => {
        linkOf(saved, 'custom').attributes.url = 'https://example.com/b'
      },
    ],
    [
      'an internal link to a different document',
      (saved: Json) => {
        linkOf(saved, 'internal').attributes.targetDocumentId = 'page-9'
      },
    ],
    [
      'a swapped image (a different media document)',
      (saved: Json) => {
        const image = imageOf(saved)
        image.targetDocumentId = 'media-2'
        image.src = '/dog.png'
      },
    ],
    [
      'a formatting change (bold toggled)',
      (saved: Json) => {
        findNode(saved, (node) => node.type === 'text').format = 1
      },
    ],
    [
      'a changed caption',
      (saved: Json) => {
        imageOf(saved).caption.editorState.root.children[0].children[0].text = 'A dog'
      },
    ],
    [
      'an attribute the rule does not know about',
      (saved: Json) => {
        imageOf(saved).document.focalPoint = 'top'
      },
    ],
    [
      'an authored alt text change',
      (saved: Json) => {
        imageOf(saved).altText = 'an authored dog'
      },
    ],
  ])('%s: no caret, the wrapper keeps focus', async (_name, serverCopy) => {
    await saveAndReload(serverCopy)
    expect(document.activeElement).toBe(wrapper())
    expect(caretOf(editorOf(editorRoot()))).toBeNull()
  })
})
