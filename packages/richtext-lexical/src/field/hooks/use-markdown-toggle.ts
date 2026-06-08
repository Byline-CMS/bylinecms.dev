'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useRef } from 'react'

import { $createCodeNode, $isCodeNode } from '@lexical/code'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, type EditorState, RootNode } from 'lexical'

import { APPLY_VALUE_TAG } from '../constants'
import { useMarkdownMode } from '../context/markdown-mode-context'
import { BYLINE_TRANSFORMERS } from '../markdown/transformers'

const MARKDOWN_LANGUAGE = 'markdown'

/** Trailing blank lines are semantically meaningless in markdown — ignore
 * them when deciding whether the user actually edited the source. */
function normalize(markdown: string): string {
  return markdown.replace(/\n+$/, '')
}

/**
 * Document-level "view as markdown source" toggle for a single editor.
 *
 * The editor is bound to a Byline form field that accumulates
 * `DocumentPatch[]`, so this hook is deliberate about persistence:
 *
 *  - While in markdown mode the surface is a single `CodeNode` of raw
 *    markdown text. `markdownModeRef` suppresses the editor's
 *    `OnChangePlugin` so none of those keystrokes reach the form.
 *  - A pure round-trip (WYSIWYG → markdown → WYSIWYG with no edits)
 *    restores the *exact* captured `EditorState` — identical serialized
 *    state, so the form sees no change and records **no patch**.
 *  - Edits made in markdown produce a single conversion back to rich
 *    nodes on exit, emitting one field value change → **one patch**.
 */
export function useMarkdownToggle(): {
  isMarkdown: boolean
  toggleMarkdown: () => void
} {
  const [editor] = useLexicalComposerContext()
  const { isMarkdown, setIsMarkdown, markdownModeRef } = useMarkdownMode()

  // Exact rich state captured on entry, restored verbatim on a no-edit exit.
  const originalEditorStateRef = useRef<EditorState | null>(null)
  // The markdown we generated on entry — compared against the code node text
  // on exit to detect whether the user touched the source.
  const originalMarkdownRef = useRef<string>('')
  // Unregister fn for the root-shape guard, live only while in markdown mode.
  const unregisterTransformRef = useRef<(() => void) | null>(null)

  const registerRootGuard = useCallback(() => {
    unregisterTransformRef.current?.()
    // Safety net: keep the root as exactly one markdown CodeNode so the user
    // can't split it into sibling root nodes while editing source.
    unregisterTransformRef.current = editor.registerNodeTransform(RootNode, (rootNode) => {
      let codeNode = rootNode.getChildren().find($isCodeNode)
      if (codeNode == null) {
        codeNode = $createCodeNode(MARKDOWN_LANGUAGE)
      }
      if (rootNode.getChildrenSize() !== 1 || codeNode.getParent() == null) {
        rootNode.splice(0, rootNode.getChildrenSize(), [codeNode])
        codeNode.selectEnd()
      }
      if (codeNode.getLanguage() !== MARKDOWN_LANGUAGE) {
        codeNode.setLanguage(MARKDOWN_LANGUAGE)
      }
    })
  }, [editor])

  const clearRootGuard = useCallback(() => {
    unregisterTransformRef.current?.()
    unregisterTransformRef.current = null
  }, [])

  const enterMarkdown = useCallback(() => {
    originalEditorStateRef.current = editor.getEditorState()
    // Suppress persistence *before* mutating so the code-block snapshot is
    // never emitted to the form.
    markdownModeRef.current = true
    editor.update(() => {
      const markdown = $convertToMarkdownString(BYLINE_TRANSFORMERS, undefined, true)
      originalMarkdownRef.current = markdown
      const codeNode = $createCodeNode(MARKDOWN_LANGUAGE)
      $getRoot().clear().append(codeNode)
      codeNode.select().insertRawText(markdown)
    })
    registerRootGuard()
    setIsMarkdown(true)
  }, [editor, markdownModeRef, registerRootGuard, setIsMarkdown])

  const exitMarkdown = useCallback(() => {
    clearRootGuard()

    let currentMarkdown = ''
    editor.read(() => {
      const first = $getRoot().getFirstChild()
      currentMarkdown = $isCodeNode(first) ? first.getTextContent() : $getRoot().getTextContent()
    })

    const edited = normalize(currentMarkdown) !== normalize(originalMarkdownRef.current)

    if (!edited && originalEditorStateRef.current != null) {
      // Pure round-trip: restore the exact captured state. Tagged so the
      // OnChangePlugin ignores it — guaranteed no patch.
      editor.setEditorState(originalEditorStateRef.current, { tag: APPLY_VALUE_TAG })
      markdownModeRef.current = false
    } else {
      // Edited: drop the guard first so the single rebuilt rich state IS
      // emitted to the form (one field change → one patch).
      markdownModeRef.current = false
      editor.update(() => {
        $convertFromMarkdownString(currentMarkdown, BYLINE_TRANSFORMERS, undefined, true)
      })
    }

    originalEditorStateRef.current = null
    originalMarkdownRef.current = ''
    setIsMarkdown(false)
  }, [editor, clearRootGuard, markdownModeRef, setIsMarkdown])

  const toggleMarkdown = useCallback(() => {
    if (markdownModeRef.current) {
      exitMarkdown()
    } else {
      enterMarkdown()
    }
  }, [markdownModeRef, enterMarkdown, exitMarkdown])

  // If the host unmounts while still in markdown mode, drop the transform.
  useEffect(() => () => clearRootGuard(), [clearRootGuard])

  return { isMarkdown, toggleMarkdown }
}
