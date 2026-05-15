/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
 */

import { CodeHighlightNode, CodeNode, registerCodeHighlighting } from '@lexical/code'
import { defineExtension } from 'lexical'

export const CodeHighlightExtension = defineExtension({
  name: '@byline/richtext-lexical/CodeHighlight',
  nodes: () => [CodeNode, CodeHighlightNode],
  register: (editor) => registerCodeHighlighting(editor),
})
