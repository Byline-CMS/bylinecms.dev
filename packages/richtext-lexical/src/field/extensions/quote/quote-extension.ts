/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { QuoteNode } from '@lexical/rich-text'
import { defineExtension } from 'lexical'

/**
 * Owns `QuoteNode`.
 *
 * Separate from {@link HeadingExtension} on purpose: a field may want
 * headings without block quotes, or neither. See the heading extension
 * for why Byline owns these nodes rather than adopting
 * `RichTextExtension`.
 */
export const QuoteExtension = defineExtension({
  name: '@byline/richtext-lexical/Quote',
  nodes: () => [QuoteNode],
})
