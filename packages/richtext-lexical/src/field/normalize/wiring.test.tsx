import { act, createRef } from 'react'

import { defineAdminConfig } from '@byline/core'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, type LexicalEditor, type SerializedEditorState } from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ApplyValuePlugin } from '../apply-value-plugin'
import { builtInExtensions } from '../config/built-in-extension-names'
import { defaultClientEditorConfig } from '../config/default-extensions'
import { EditorContext } from '../editor-context'
import { hashSerializedState } from '../utils/hashSerializedState'

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
const heading = (value: string) => ({
  children: [text(value)],
  direction: null,
  format: '',
  indent: 0,
  type: 'heading',
  version: 1,
  tag: 'h1',
})
const image = () => ({
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
          root: { children: [], direction: null, format: '', indent: 0, type: 'root', version: 1 },
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

interface Harness {
  container: HTMLDivElement
  editor: () => LexicalEditor
  render: (value: SerializedEditorState) => Promise<void>
}

/**
 * Mounts the real EditorContext + ApplyValuePlugin pair, composed the
 * way `editor-component.tsx` composes them. Exercising the wiring is the
 * point: calling `normalizeValue` directly here would prove nothing
 * about the path a stored value actually travels.
 */
async function mount(removals: string[], initial?: SerializedEditorState): Promise<Harness> {
  const extensions = defaultClientEditorConfig.extensions?.clone()
  for (const name of removals) extensions.remove(name)

  const lastEmittedHashRef = createRef<string | undefined>() as React.RefObject<string | undefined>
  const normalizedIncomingHashRef = createRef<string | undefined>() as React.RefObject<
    string | undefined
  >
  const hasNormalizedBaselineRef = { current: false }

  let instance: LexicalEditor | undefined
  function Capture(): null {
    const [editor] = useLexicalComposerContext()
    instance = editor
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })

  const paint = async (value?: SerializedEditorState) => {
    await act(async () => {
      root.render(
        <EditorContext
          composerKey="wiring"
          editorConfig={{ ...defaultClientEditorConfig, extensions }}
          onChange={() => {}}
          readOnly={false}
          value={value}
        >
          <ApplyValuePlugin
            value={value}
            incomingHash={value != null ? hashSerializedState(value) : undefined}
            lastEmittedHashRef={lastEmittedHashRef}
            normalizedIncomingHashRef={normalizedIncomingHashRef}
            hasNormalizedBaselineRef={hasNormalizedBaselineRef}
          />
          <Capture />
        </EditorContext>
      )
    })
  }

  await paint(initial)
  return {
    container,
    editor: () => {
      if (instance == null) throw new Error('editor never captured')
      return instance
    },
    render: paint,
  }
}

function editorText(editor: LexicalEditor): string {
  let value = ''
  editor.read(() => {
    value = $getRoot().getTextContent()
  })
  return value
}

function blockTypes(editor: LexicalEditor): string[] {
  let types: string[] = []
  editor.read(() => {
    types = $getRoot()
      .getChildren()
      .map((node) => node.getType())
  })
  return types
}

describe('normalization wiring', () => {
  it('mounts with unsupported initial content instead of throwing', async () => {
    // Before this wiring existed the editor build itself threw
    // `parseEditorState: type "heading" + not found` and the field
    // opened blank.
    const harness = await mount([builtInExtensions.Heading], doc(heading('Legacy title')))
    expect(blockTypes(harness.editor())).toEqual(['paragraph'])
    expect(editorText(harness.editor())).toBe('Legacy title')
  })

  it('shows the adapted notice', async () => {
    const harness = await mount([builtInExtensions.Heading], doc(heading('Legacy title')))
    expect(harness.container.textContent).toContain('no longer supports')
    expect(harness.container.querySelector('.byline-richtext-notice--adapted')).not.toBeNull()
  })

  it('shows no notice when nothing needed adapting', async () => {
    const harness = await mount([], doc(heading('Ordinary title')))
    expect(harness.container.querySelector('.byline-richtext-notice')).toBeNull()
    expect(blockTypes(harness.editor())).toEqual(['heading'])
  })

  it('normalizes a replacement value applied after mount', async () => {
    const harness = await mount([builtInExtensions.Heading])
    await harness.render(doc(heading('Applied later')))
    expect(blockTypes(harness.editor())).toEqual(['paragraph'])
    expect(editorText(harness.editor())).toBe('Applied later')
  })

  it('opens read-only and names the content when there is no conversion', async () => {
    const harness = await mount([builtInExtensions.InlineImage], doc(image()))
    const notice = harness.container.querySelector('.byline-richtext-notice--refused')
    expect(notice).not.toBeNull()
    // A readable name, not the raw node type.
    expect(notice?.textContent).toContain('an image')
    expect(notice?.textContent).not.toContain('inline-image')
    expect(notice?.textContent).toContain('read-only')
    expect(notice?.textContent).toContain('administrator')
    // The editing surface is withheld rather than showing partial content.
    expect(harness.container.querySelector('.editor-container')).toBeNull()
  })

  it('recovers when a valid value arrives after a refusal', async () => {
    // The apply plugin lives in `children`, so an earlier version that
    // dropped children on refusal stranded the field: nothing was left
    // mounted to apply a later value or clear the notice.
    const harness = await mount([builtInExtensions.InlineImage], doc(image()))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).not.toBeNull()

    await harness.render(doc(heading('Recovered')))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).toBeNull()
    expect(harness.container.querySelector('.editor-container')).not.toBeNull()
    expect(editorText(harness.editor())).toBe('Recovered')
  })

  it('survives valid, then refused, then valid again', async () => {
    const harness = await mount([builtInExtensions.InlineImage], doc(heading('First')))
    expect(editorText(harness.editor())).toBe('First')

    await harness.render(doc(image()))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).not.toBeNull()

    await harness.render(doc(heading('Third')))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).toBeNull()
    expect(editorText(harness.editor())).toBe('Third')
  })

  it('clears the field after a refusal', async () => {
    const harness = await mount([builtInExtensions.InlineImage], doc(image()))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).not.toBeNull()

    const empty = doc({
      children: [],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    })
    await harness.render(empty)
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).toBeNull()
    expect(editorText(harness.editor())).toBe('')
  })

  it('recovers when the SAME value returns after a refusal', async () => {
    // The plugin remembers the last value it applied, and a refusal
    // applies nothing — so returning to a previously applied value could
    // be mistaken for "already applied" and skipped, leaving the notice
    // stuck. Toggling between two values is the case a user hits first.
    const harness = await mount([builtInExtensions.InlineImage], doc(heading('Kept')))
    expect(editorText(harness.editor())).toBe('Kept')

    await harness.render(doc(image()))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).not.toBeNull()

    // The same value as before the refusal, not merely a different valid one.
    await harness.render(doc(heading('Kept')))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).toBeNull()
    expect(harness.container.querySelector('.editor-container')).not.toBeNull()
    expect(editorText(harness.editor())).toBe('Kept')
  })

  it('survives repeated toggling between a refused and a valid value', async () => {
    const harness = await mount([builtInExtensions.InlineImage], doc(image()))
    for (let cycle = 0; cycle < 3; cycle++) {
      await harness.render(doc(heading('Toggled')))
      expect(
        harness.container.querySelector('.byline-richtext-notice--refused'),
        `cycle ${cycle}: expected the notice to clear`
      ).toBeNull()
      expect(editorText(harness.editor()), `cycle ${cycle}`).toBe('Toggled')

      await harness.render(doc(image()))
      expect(
        harness.container.querySelector('.byline-richtext-notice--refused'),
        `cycle ${cycle}: expected the notice to return`
      ).not.toBeNull()
    }
  })

  it('names an unknown node type by its id rather than failing', async () => {
    // A site or plugin contributing its own node supplies no label. The
    // id is developer vocabulary, but it is accurate and searchable —
    // and reaching this path at all is rare.
    const custom = doc({
      children: [],
      direction: null,
      format: '',
      indent: 0,
      type: 'acme-callout',
      version: 1,
    })
    const harness = await mount([], custom)
    const notice = harness.container.querySelector('.byline-richtext-notice--refused')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('acme-callout')
  })

  it('still edits normally when the image is supported', async () => {
    const harness = await mount([], doc(image()))
    expect(harness.container.querySelector('.byline-richtext-notice--refused')).toBeNull()
    expect(harness.container.querySelector('.editor-container')).not.toBeNull()
  })
})
