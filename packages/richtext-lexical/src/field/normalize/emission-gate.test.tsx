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
