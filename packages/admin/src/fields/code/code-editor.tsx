/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useRef } from 'react'

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'

// ---------------------------------------------------------------------------
// CodeEditor — the CodeMirror 6 half of the `code` field widget.
//
// This module owns EVERY CodeMirror import and is loaded through
// `React.lazy` from `code-field.tsx`, so none of it lands in the main admin
// chunk — the consuming app's bundler splits it out and fetches it the first
// time a code field actually renders. Keep it dependency-tight: anything
// imported here ships in the lazy chunk.
//
// Theming: one theme + one highlight style, both defined entirely in terms
// of `--byline-code-*` CSS custom properties (declared with light/dark
// values in `code-field.module.css`). The admin theme contract is a
// `.dark`/`.light` class on <html>, so the editor follows theme flips live
// with zero JS involvement.
// ---------------------------------------------------------------------------

/**
 * Per-language lazy loaders. Each grammar stays in its own chunk — adding a
 * code field to a document only fetches the grammar it actually uses.
 * Unknown languages resolve to `null` → plain text (no language extension).
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<Extension>> = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  typescript: () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true, typescript: true })
    ),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
}

/** Common aliases → canonical loader keys. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  py: 'python',
  yml: 'yaml',
}

const resolveLanguageLoader = (language: string | undefined): (() => Promise<Extension>) | null => {
  if (!language) return null
  const key = LANGUAGE_ALIASES[language] ?? language
  return LANGUAGE_LOADERS[key] ?? null
}

const bylineCodeTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--byline-code-bg)',
    color: 'var(--byline-code-fg)',
    fontSize: 'var(--byline-code-font-size, 13px)',
    border: '1px solid var(--byline-code-border)',
    borderRadius: 'var(--byline-code-radius, 4px)',
  },
  '&.cm-focused': {
    outline: '2px solid var(--byline-code-focus-ring)',
    outlineOffset: '-1px',
  },
  '.cm-content': {
    fontFamily: 'var(--byline-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    caretColor: 'var(--byline-code-caret)',
    minHeight: 'var(--byline-code-min-height, 6rem)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    maxHeight: 'var(--byline-code-max-height, 32rem)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--byline-code-gutter-bg)',
    color: 'var(--byline-code-gutter-fg)',
    border: 'none',
    borderRight: '1px solid var(--byline-code-border)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--byline-code-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--byline-code-active-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--byline-code-selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--byline-code-caret)' },
})

const bylineHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--byline-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--byline-code-string)' },
  { tag: tags.comment, color: 'var(--byline-code-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--byline-code-number)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--byline-code-function)',
  },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--byline-code-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--byline-code-property)' },
  { tag: [tags.operator, tags.definitionKeyword], color: 'var(--byline-code-operator)' },
])

export interface CodeEditorProps {
  id?: string
  /** Initial document. External updates sync only while the editor is unfocused. */
  value: string
  /** Highlight language (canonical name or alias). Unknown → plain text. */
  language?: string
  readOnly?: boolean
  onChange?: (value: string) => void
  ariaInvalid?: boolean
  ariaDescribedBy?: string
}

const CodeEditor = ({
  id,
  value,
  language,
  readOnly,
  onChange,
  ariaInvalid,
  ariaDescribedBy,
}: CodeEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Keep the latest onChange without recreating the EditorView.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const languageCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  const ariaCompartment = useRef(new Compartment())
  const initialValueRef = useRef(value)

  // Create the view once per mount. The form store lives above the tab
  // layout, so remounts (tab switches, conditional visibility) re-seed from
  // the store-backed `value` — same contract the other widgets follow.
  useEffect(() => {
    if (containerRef.current == null) return
    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        bylineCodeTheme,
        syntaxHighlighting(bylineHighlightStyle),
        languageCompartment.current.of([]),
        readOnlyCompartment.current.of([]),
        ariaCompartment.current.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString())
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // External value sync — only while unfocused, so we never fight the
  // editor's own keystrokes (our own onChange echoes back as an equal doc).
  useEffect(() => {
    const view = viewRef.current
    if (view == null || view.hasFocus) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Language switching through a compartment: each grammar loads lazily the
  // first time it's requested and reconfigures in place (no view recreation).
  useEffect(() => {
    let cancelled = false
    const view = viewRef.current
    if (view == null) return
    const loader = resolveLanguageLoader(language)
    if (loader == null) {
      view.dispatch({ effects: languageCompartment.current.reconfigure([]) })
      return
    }
    loader()
      .then((extension) => {
        if (!cancelled && viewRef.current != null) {
          viewRef.current.dispatch({
            effects: languageCompartment.current.reconfigure(extension),
          })
        }
      })
      .catch(() => {
        // Grammar chunk failed to load — degrade to plain text.
      })
    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly === true),
        EditorView.editable.of(readOnly !== true),
      ]),
    })
  }, [readOnly])

  // ARIA lives on CodeMirror's own contenteditable (which already carries
  // role="textbox"), not on the wrapper div.
  useEffect(() => {
    const attributes: Record<string, string> = {}
    if (ariaInvalid) attributes['aria-invalid'] = 'true'
    if (ariaDescribedBy) attributes['aria-describedby'] = ariaDescribedBy
    viewRef.current?.dispatch({
      effects: ariaCompartment.current.reconfigure(EditorView.contentAttributes.of(attributes)),
    })
  }, [ariaInvalid, ariaDescribedBy])

  return <div ref={containerRef} id={id} className="byline-code-editor" />
}

export default CodeEditor
