/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
 */

import { CodeHighlightNode, CodeNode } from '@lexical/code'
// Lexical 0.51 removed the Prism re-exports from `@lexical/code`, which is
// now a thin facade over `@lexical/code-core` with no highlighter of its
// own. The tokenizer lives in a sibling package per highlighter —
// `@lexical/code-prism` keeps the Prism behaviour this editor already had;
// `@lexical/code-shiki` is the alternative and does not ship the language
// maps the toolbar reads.
import { registerCodeHighlighting } from '@lexical/code-prism'
import { defineExtension } from 'lexical'

export const CodeHighlightExtension = defineExtension({
  name: '@byline/richtext-lexical/CodeHighlight',
  nodes: () => [CodeNode, CodeHighlightNode],
  register: (editor) => registerCodeHighlighting(editor),
})
