/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { HeadingNode } from '@lexical/rich-text'
import { defineExtension } from 'lexical'

/**
 * Owns `HeadingNode`.
 *
 * Byline deliberately does not adopt `@lexical/rich-text`'s
 * `RichTextExtension` for this. That extension binds heading and quote
 * registration to general rich-text behaviour, so adopting it would
 * register headings in every rich-text field — and a field configured
 * without headings would still accept one from a paste, which is the
 * defect this package had. Owning the node here keeps headings
 * removable on their own, independently of quotes and of rich-text
 * behaviour itself.
 */
export const HeadingExtension = defineExtension({
  name: '@byline/richtext-lexical/Heading',
  nodes: () => [HeadingNode],
})
