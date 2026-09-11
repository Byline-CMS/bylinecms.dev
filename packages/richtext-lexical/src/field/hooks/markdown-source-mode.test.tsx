import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { CodeNode } from '@lexical/code'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { builtInExtensions } from '../config/built-in-extension-names'
import { defaultClientEditorConfig } from '../config/default-extensions'
import { EditorContext } from '../editor-context'
import { useMarkdownToggle } from './use-markdown-toggle'

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

interface Harness {
  editor: LexicalEditor
  container: HTMLDivElement
  toggle: () => Promise<void>
  isMarkdown: () => boolean
  /**
   * Editor updates wrapped in an async act() so React state settles.
   * Lexical flushes its listeners in a microtask, and ToolbarPlugin sets
   * state from them, so a synchronous act() leaves those updates outside
   * the scope and React warns.
   */
  update: (fn: () => void) => Promise<void>
  changes: Array<{ text: string }>
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

async function mount(
  removals: string[],
  options: { markdownToggleControl?: boolean } = {}
): Promise<Harness> {
  const extensions = defaultClientEditorConfig.extensions?.clone()
  for (const name of removals) extensions.remove(name)

  const settings = {
    ...defaultClientEditorConfig.settings,
    controls: {
      ...defaultClientEditorConfig.settings.controls,
      // Default the preference ON so a missing button proves the
      // capability gate, not a preference left switched off.
      markdownToggle: options.markdownToggleControl ?? true,
    },
  }

  const changes: Array<{ text: string }> = []

  let editor: LexicalEditor | undefined
  let toggleMarkdown: (() => void) | undefined
  let isMarkdown = false

  function Probe(): null {
    const [instance] = useLexicalComposerContext()
    const markdown = useMarkdownToggle()
    editor = instance
    toggleMarkdown = markdown.toggleMarkdown
    isMarkdown = markdown.isMarkdown
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })

  await act(async () => {
    root.render(
      <EditorContext
        composerKey="markdown"
        editorConfig={{ ...defaultClientEditorConfig, settings, extensions }}
        onChange={(editorState) => {
          editorState.read(() => {
            changes.push({ text: $getRoot().getTextContent() })
          })
        }}
        readOnly={false}
      >
        <Probe />
      </EditorContext>
    )
  })

  if (editor == null || toggleMarkdown == null) throw new Error('probe never ran')
  const instance = editor
  return {
    editor: instance,
    container,
    changes,
    toggle: async () => {
      await act(async () => {
        toggleMarkdown?.()
      })
    },
    isMarkdown: () => isMarkdown,
    update: async (fn: () => void) => {
      await act(async () => {
        instance.update(fn, { discrete: true })
      })
    },
  }
}

function text(editor: LexicalEditor): string {
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

async function seedParagraph(harness: Harness, value: string): Promise<void> {
  await harness.update(() => {
    $getRoot()
      .clear()
      .append($createParagraphNode().append($createTextNode(value)))
  })
}

describe('Markdown source mode follows the editor capabilities', () => {
  it('round-trips with headings removed, preserving text and producing no heading', async () => {
    const harness = await mount([builtInExtensions.Heading])
    await seedParagraph(harness, 'Body text')

    await harness.toggle()
    expect(harness.isMarkdown()).toBe(true)
    // While in source mode the surface is a single CodeNode of raw text.
    expect(blockTypes(harness.editor)).toEqual(['code'])

    // Edit the source, introducing Markdown for a structure this field
    // no longer supports.
    await harness.update(() => {
      const code = $getRoot().getFirstChild()
      code?.selectEnd().insertRawText('\n\n# Smuggled heading')
    })

    await harness.toggle()
    expect(harness.isMarkdown()).toBe(false)
    expect(blockTypes(harness.editor)).not.toContain('heading')
    expect(text(harness.editor)).toContain('Smuggled heading')
  })

  it('hides the toggle button when the code node is unregistered', async () => {
    // The preference is ON in this fixture, so an absent button proves
    // the capability gate rather than a switched-off preference.
    const withCode = await mount([])
    expect(withCode.container.querySelector('.markdown-toggle')).not.toBeNull()

    const withoutCode = await mount([builtInExtensions.CodeHighlight])
    expect(withoutCode.editor.hasNodes([CodeNode])).toBe(false)
    expect(withoutCode.container.querySelector('.markdown-toggle')).toBeNull()
  })

  it('a rejected toggle leaves the field still able to persist', async () => {
    // CodeHighlightExtension owns CodeNode, and source mode holds its
    // text in one. Without it, $createCodeNode throws.
    const harness = await mount([builtInExtensions.CodeHighlight])
    expect(harness.editor.hasNodes([CodeNode])).toBe(false)

    const before = blockTypes(harness.editor)
    await expect(harness.toggle()).resolves.toBeUndefined()
    expect(harness.isMarkdown()).toBe(false)
    expect(blockTypes(harness.editor)).toEqual(before)

    // `isMarkdown` and `markdownModeRef` are separate state, and it is
    // the ref that suppresses persistence. Setting it before the throwing
    // call would leave the field silently unable to save, which this
    // catches: ordinary editing after a rejected toggle must still reach
    // onChange.
    harness.changes.length = 0
    await seedParagraph(harness, 'typed after the rejected toggle')

    expect(harness.changes.length).toBeGreaterThan(0)
    expect(harness.changes.at(-1)?.text).toContain('typed after the rejected toggle')
  })

  it('offers source mode with the default configuration', async () => {
    const harness = await mount([])
    expect(harness.editor.hasNodes([CodeNode])).toBe(true)
    await harness.toggle()
    expect(harness.isMarkdown()).toBe(true)
  })
})
