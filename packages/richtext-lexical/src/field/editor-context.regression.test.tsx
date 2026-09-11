import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { MarkNode } from '@lexical/mark'
import { OverflowNode } from '@lexical/overflow'
import { HeadingNode } from '@lexical/rich-text'
import type { LexicalEditor } from 'lexical'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { builtInExtensions } from './config/built-in-extension-names'
import { defaultClientEditorConfig } from './config/default-extensions'
import { EditorContext } from './editor-context'
import { CoreNodesExtension } from './extensions/core-nodes/core-nodes-extension'
import { READABLE_NODES } from './nodes'
import { CaptureEditor } from './test-support/capture-editor'

// biome-ignore lint/suspicious/noExplicitAny: React act environment flag
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// The editor's toolbar resolves the admin config unconditionally, so with
// none registered the mount throws "Byline has not been configured yet".
// Register a real minimal one rather than mocking `@byline/core` — the
// same approach `@byline/admin`'s form tests take. It lives on a global,
// so module scope runs it once.
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
 * Mounts the REAL EditorContext. The shared jsdom builders in
 * `test-support/build-test-editor.ts` compose their own root extension
 * and so cannot see a blanket node list living in the shipped
 * component — this test can, which is why the defect is pinned here.
 */
/** Every root mounted by this file, unmounted after each test. */
const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  // Without this each test leaves a live editor and its listeners
  // attached to the document, which leaks between tests.
  for (const { root, container } of mounted.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

function mountEditor(removals: string[]): LexicalEditor {
  const extensions = defaultClientEditorConfig.extensions?.clone()
  for (const name of removals) extensions.remove(name)

  let editor: LexicalEditor | undefined
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })

  act(() => {
    root.render(
      <EditorContext
        composerKey="regression"
        editorConfig={{ ...defaultClientEditorConfig, extensions }}
        onChange={() => {}}
        readOnly={false}
      >
        <CaptureEditor
          onEditor={(instance) => {
            editor = instance
          }}
        />
      </EditorContext>
    )
  })

  if (editor == null) throw new Error('editor was never captured')
  return editor
}

describe('EditorContext registers only what its extensions own', () => {
  it('does not register headings when the heading extension is removed', () => {
    const editor = mountEditor([builtInExtensions.Heading])
    expect(editor.hasNode(HeadingNode)).toBe(false)
  })

  it('still registers headings with the default configuration', () => {
    const editor = mountEditor([])
    expect(editor.hasNode(HeadingNode)).toBe(true)
  })

  it('registers every readable node class with the default configuration', () => {
    const editor = mountEditor([])
    // The former blanket list, now the read vocabulary. Every class in it
    // must still be reachable through an extension, or the default
    // configuration has silently lost a feature.
    const missing = READABLE_NODES.filter((klass) => !editor.hasNode(klass)).map((klass) =>
      klass.getType()
    )
    expect(missing).toEqual([])
  })

  it('keeps the core nodes even when site code tries to remove them', () => {
    // `remove()` matches by name and accepts the extension object, so
    // this is a removal a site could really attempt. The root injects
    // CoreNodesExtension outside the configurable list, so it survives.
    const editor = mountEditor([CoreNodesExtension.name])
    expect(editor.hasNode(MarkNode)).toBe(true)
    expect(editor.hasNode(OverflowNode)).toBe(true)
  })
})
