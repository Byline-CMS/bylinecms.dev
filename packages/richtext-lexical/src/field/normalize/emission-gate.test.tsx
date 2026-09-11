import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { builtInExtensions } from '../config/built-in-extension-names'
import { defaultClientEditorConfig } from '../config/default-extensions'
import { EditorComponent } from '../editor-component'

// biome-ignore lint/suspicious/noExplicitAny: React act environment flag
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
})

/**
 * jsdom implements no `requestIdleCallback`, so `editor-component` takes
 * its synchronous `else` branch and an emission scheduled before a value
 * swap can never land after it. That hides an entire class of ordering
 * bug from this suite. These tests install a deferring shim so the
 * window between scheduling and emitting is real.
 */
let pending: Array<() => void> = []

beforeEach(() => {
  pending = []
  // biome-ignore lint/suspicious/noExplicitAny: shimming a missing jsdom API
  ;(window as any).requestIdleCallback = (cb: () => void) => {
    pending.push(cb)
    return pending.length
  }
  // biome-ignore lint/suspicious/noExplicitAny: shimming a missing jsdom API
  ;(window as any).cancelIdleCallback = () => {}
})

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: shimming a missing jsdom API
  ;(window as any).requestIdleCallback = undefined
  // biome-ignore lint/suspicious/noExplicitAny: shimming a missing jsdom API
  ;(window as any).cancelIdleCallback = undefined
})

const text = (value: string) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})
// biome-ignore lint/suspicious/noExplicitAny: serialized fixtures are structural
const doc = (...children: unknown[]): any => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})
const headingNode = (value: string) => ({
  children: [text(value)],
  direction: null,
  format: '',
  indent: 0,
  type: 'heading',
  version: 1,
  tag: 'h1',
})
const paragraph = (value: string) => ({
  children: [text(value)],
  direction: null,
  format: '',
  indent: 0,
  type: 'paragraph',
  version: 1,
})
const imageDoc = () =>
  doc({
    children: [
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
        showCaption: false,
        caption: {
          editorState: {
            root: {
              children: [],
              direction: null,
              format: '',
              indent: 0,
              type: 'root',
              version: 1,
            },
          },
        },
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  })

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

/**
 * Let the normalization baseline settle.
 *
 * ApplyValuePlugin captures what Lexical actually settled on after a
 * microtask and two animation frames, and `editor-component` suppresses
 * emission until it has. A test that edits before then sees no emission
 * for the right reason but the wrong one.
 */
async function settleBaseline(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

/** Mount EditorComponent and report every value it emits. */
async function mountField(
  removals: string[],
  value: SerializedEditorState,
  onChange: (next: SerializedEditorState) => void
): Promise<{ editor: () => LexicalEditor; container: HTMLDivElement }> {
  const extensions = defaultClientEditorConfig.extensions?.clone()
  for (const name of removals) extensions.remove(name)

  let editor: LexicalEditor | undefined
  function Capture(): null {
    const [instance] = useLexicalComposerContext()
    editor = instance
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })

  await act(async () => {
    root.render(
      <EditorComponent
        id="field"
        name="field"
        editorConfig={{ ...defaultClientEditorConfig, extensions }}
        value={value}
        onChange={onChange}
        featureChildren={[<Capture key="capture" />]}
      />
    )
  })
  return {
    container,
    editor: () => {
      if (editor == null) throw new Error('editor never captured')
      return editor
    },
  }
}

/**
 * These assert on what the editor EMITS, not on what a form ends up
 * holding. From the form's side a suppressed emission and an emission
 * that happens to equal the stored value are indistinguishable — both
 * produce no patch — yet only one is the behaviour the spec asks for.
 */
describe('adapted content and the change gate', () => {
  it('emits nothing when adapted content is merely loaded', async () => {
    const onChange = vi.fn()
    await mountField([builtInExtensions.Heading], doc(headingNode('Legacy title')), onChange)
    await settleBaseline()
    await act(async () => {
      for (const cb of pending.splice(0)) cb()
    })
    // The adaptation is presentational. Emitting here would make every
    // affected document dirty on open and persist the adapted form on the
    // next unrelated save.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits the adapted content, including the new text, once edited', async () => {
    const onChange = vi.fn()
    const harness = await mountField(
      [builtInExtensions.Heading],
      doc(headingNode('Legacy title')),
      onChange
    )
    await settleBaseline()
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      harness.editor().update(
        () => {
          $getRoot().selectEnd()
          $getRoot().append($createParagraphNode().append($createTextNode('and more')))
        },
        { discrete: true }
      )
    })
    await act(async () => {
      for (const cb of pending.splice(0)) cb()
    })

    expect(onChange).toHaveBeenCalled()
    const emitted = JSON.stringify(onChange.mock.calls.at(-1)?.[0])
    // Expected loss: the adaptation persists once the reader edits. What
    // must NOT happen is losing either the original text or the edit.
    expect(emitted).not.toContain('"type":"heading"')
    expect(emitted).toContain('Legacy title')
    expect(emitted).toContain('and more')
  })
})

describe('a refused field must not emit the previous document as its value', () => {
  it('suppresses a deferred emission scheduled before the refusal', async () => {
    const onChange = vi.fn()
    const extensions = defaultClientEditorConfig.extensions?.clone()
    extensions.remove(builtInExtensions.InlineImage)
    const editorConfig = { ...defaultClientEditorConfig, extensions }

    let editor: LexicalEditor | undefined
    function Capture(): null {
      const [instance] = useLexicalComposerContext()
      editor = instance
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    const paint = async (value: SerializedEditorState) => {
      await act(async () => {
        root.render(
          <EditorComponent
            id="gate"
            name="gate"
            editorConfig={editorConfig}
            value={value}
            onChange={onChange}
            featureChildren={[<Capture key="capture" />]}
          />
        )
      })
    }

    await paint(doc(paragraph('Original')))
    expect(editor).toBeDefined()

    // The reader edits. handleChange defers the emission.
    await act(async () => {
      editor?.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode('SECRET EDIT')))
        },
        { discrete: true }
      )
    })
    expect(pending.length).toBeGreaterThan(0)

    // Before it fires, the value swaps to a document this field cannot
    // accept — a locale switch or a version restore.
    await paint(imageDoc())
    expect(container.querySelector('.byline-richtext-notice--refused')).not.toBeNull()

    // The deferred callback now fires.
    await act(async () => {
      for (const cb of pending.splice(0)) cb()
    })

    // It must NOT emit: the editor does not hold the refused document, so
    // anything it emits would overwrite the image document's body with
    // the previous document's content — exactly the loss refusal exists
    // to prevent.
    const emitted = onChange.mock.calls.map((call) => JSON.stringify(call[0])).join('')
    expect(emitted).not.toContain('SECRET EDIT')
    expect(emitted).not.toContain('Original')
    expect(onChange).not.toHaveBeenCalled()
  })
})
