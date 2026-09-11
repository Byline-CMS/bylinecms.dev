/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * **Admin-side half of the compact editor.** Pair with the
 * `lexicalRichTextCompact()` schema helper, which carries the JSON-safe
 * toolbar preferences; this file carries the extension set, which is not
 * JSON-safe and so cannot live in a schema.
 *
 * Compact sits between a strictly inline field and the full editor: no
 * block structures, but links and inline images survive, because a
 * caption or a credit line usually wants both. Adjust the removals below
 * to suit your own fields — this is an example, not a fixed policy.
 *
 * Removing an extension decides what the field ACCEPTS as well as what
 * it offers, since each extension owns its node classes. Without this
 * half, a compact field hid the block-format dropdown while still
 * storing a heading that arrived by paste.
 *
 * Bold, italic and inline code cannot be constrained here: they are
 * `TextNode` formats rather than node types, so they have no node to
 * unregister and still arrive by paste.
 */

import type { FieldAdminConfig, RichTextEditorProps } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

/**
 * The extension narrowing, exported separately from the component.
 *
 * `lexicalEditor()` closes over its callback inside a lazy component, so
 * the resolved list is not reachable from the outside. Naming the
 * callback lets a test assert which extensions this preset removes —
 * which is the whole of its contract now that removal decides what a
 * field accepts.
 */
export function configureCompactEditor<T extends { extensions?: any }>(c: T): T {
  c.extensions
    // Block structures — a caption is not a place for a heading, a
    // quote, a list or a table.
    .remove(builtInExtensions.Heading)
    .remove(builtInExtensions.Quote)
    .remove(builtInExtensions.List)
    .remove(builtInExtensions.CheckList)
    .remove(builtInExtensions.Table)
    .remove(builtInExtensions.Layout)
    .remove(builtInExtensions.Admonition)
    .remove(builtInExtensions.HorizontalRule)
    .remove(builtInExtensions.CodeHighlight)
    // Embeds — a compact field is not a place to drop a video.
    .remove(builtInExtensions.AutoEmbed)
    .remove(builtInExtensions.YouTube)
    .remove(builtInExtensions.Vimeo)
  // Link, AutoLink and InlineImage stay on purpose: captions carry
  // credits, and credits carry links.
  return c
}

export const LexicalRichTextCompact = lexicalEditor(configureCompactEditor) satisfies (
  props: RichTextEditorProps
) => React.JSX.Element

/**
 * Returns a `FieldAdminConfig` that opts a single richText field into the
 * compact editor. Drop into a `CollectionAdminConfig.fields` map, keyed
 * by the schema field's name.
 *
 * @example
 * ```ts
 * // byline/collections/<collection>/admin.tsx
 * import { compactRichTextAdmin } from '../../fields/lexical-richtext-compact-admin.jsx'
 *
 * fields: {
 *   caption: compactRichTextAdmin(),
 * }
 * ```
 */
export function compactRichTextAdmin(): FieldAdminConfig {
  return {
    editor: LexicalRichTextCompact,
  }
}
