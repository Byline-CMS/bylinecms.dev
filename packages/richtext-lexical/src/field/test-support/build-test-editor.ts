/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared editor builders for jsdom tests.
 *
 * These compose a root extension directly rather than rendering
 * `EditorContext`, which keeps capability tests fast and free of React.
 * That also means they do NOT exercise the shipped component: the
 * production root extension lives in `editor-context.tsx`, and a
 * regression there is caught by `editor-context.regression.test.tsx`,
 * not here.
 */

import { buildEditorFromExtensions } from '@lexical/extension'
import { $generateNodesFromDOM } from '@lexical/html'
import { ReactPluginHostExtension } from '@lexical/react/ReactPluginHostExtension'
import { defineExtension, type LexicalEditor } from 'lexical'

import { builtInExtensions } from '../config/built-in-extension-names'
import { defaultExtensionsList } from '../config/default-extensions'
import { CoreNodesExtension } from '../extensions/core-nodes/core-nodes-extension'

const NAMESPACE = 'LexicalRichText'

/**
 * `ReactPluginHostExtension` is required, not optional: several default
 * extensions host React decorators and `buildEditorFromExtensions`
 * throws "No ReactProviderExtension detected" without it.
 */
function build(dependencies: unknown[]) {
  return buildEditorFromExtensions(
    defineExtension({
      name: '[test-root]',
      namespace: NAMESPACE,
      // CoreNodesExtension is injected the way `EditorContext` injects
      // it — outside the configurable list — so these builders mirror
      // production rather than flattering it.
      // biome-ignore lint/suspicious/noExplicitAny: extension arguments are heterogeneous by design
      dependencies: [ReactPluginHostExtension, CoreNodesExtension, ...dependencies] as any,
    })
  )
}

/** Every default extension, as a production editor would have them. */
export function buildFullEditor() {
  return build(defaultExtensionsList().toArray())
}

/**
 * The defaults minus the named extensions. Defaults to removing every
 * Byline built-in plus the upstream list extensions — the "minimal
 * editor" a downstream site builds when it strips a field back.
 */
export function buildRestrictedEditor(removals?: string[]) {
  const names = removals ?? [
    ...Object.values(builtInExtensions),
    '@lexical/list/List',
    '@lexical/list/CheckList',
  ]
  const list = defaultExtensionsList()
  for (const name of names) list.remove(name)
  return build(list.toArray())
}

/**
 * Parse `html` through the legacy `$generateNodesFromDOM` path — the one
 * a clipboard paste actually uses — and report what the editor made of
 * it. Assertions are on node types and text, never on markup.
 *
 * Scope: this inspects the imported nodes BEFORE insertion, so it
 * evidences HTML conversion only. Real clipboard insertion — the
 * `application/x-lexical-editor` branch, its fallthrough, and what
 * survives `$insertGeneratedNodes` — is covered separately by the
 * clipboard-equivalence tests.
 */
export function parseHtmlToTypes(
  editor: LexicalEditor,
  html: string
): { types: string[]; text: string } {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  let result = { types: [] as string[], text: '' }
  editor.update(
    () => {
      const nodes = $generateNodesFromDOM(editor, dom)
      result = {
        types: nodes.map((node) => node.getType()),
        text: nodes.map((node) => node.getTextContent()).join('|'),
      }
    },
    { discrete: true }
  )
  return result
}
