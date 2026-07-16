/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * **Admin-side module** — the extension half of the minimal editor (the
 * settings half is the schema helper in `lexical-richtext-minimal.ts`;
 * see its header for the full two-sided rationale). Exports:
 *
 *   - `LexicalRichTextMinimal` — a `RichTextEditorComponent` with every
 *     node-contributing extension removed, so the toolbar's "Insert"
 *     dropdown (composed from extension-contributed items) disappears
 *     entirely, along with the link button and floating format popover.
 *   - `minimalRichTextAdmin()` — a `FieldAdminConfig` factory. Drop into a
 *     collection's `fields` map in `<collection>/admin.tsx`, keyed by the
 *     schema field's name, to opt one field into the minimal editor. This
 *     *replaces* the site-wide editor registration for that field — so a
 *     minimal field also loses the AI assistant, deliberately.
 *
 * Pairs with `lexicalRichTextMinimal()` on the schema side — schema files
 * must stay React-free and tsx-loadable.
 *
 * See `docs/FIELDS.md` for the schema-vs-admin model.
 */

import type { FieldAdminConfig, RichTextEditorProps } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

/**
 * Minimal wrapper around `@byline/richtext-lexical`'s editor: inline text
 * formatting only. Every extension that contributes structural nodes,
 * Insert-menu items, or floating UI is removed — what remains is the
 * toolbar's core format buttons (bold / italic / underline).
 *
 * `Toolbar` and `FloatingUI` (infrastructure) stay; everything they would
 * have rendered *for* the removed extensions vanishes with them.
 */
export const LexicalRichTextMinimal = lexicalEditor((c) => {
  c.extensions
    // Insert-menu contributors — with all of them gone the "Insert"
    // dropdown itself no longer renders.
    .remove(builtInExtensions.Admonition)
    .remove(builtInExtensions.HorizontalRule)
    .remove(builtInExtensions.InlineImage)
    .remove(builtInExtensions.Layout)
    .remove(builtInExtensions.Table)
    .remove(builtInExtensions.AutoEmbed)
    .remove(builtInExtensions.Vimeo)
    .remove(builtInExtensions.YouTube)
    // Code blocks (the block-format dropdown is already hidden by the
    // schema-side settings; this drops the node + highlight runtime too).
    .remove(builtInExtensions.CodeHighlight)
    // Links: the toolbar's link button is gated on the Link extension's
    // presence, and AutoLink would otherwise linkify pasted URLs.
    .remove(builtInExtensions.Link)
    .remove(builtInExtensions.AutoLink)
    // Selection popover — inline-only fields don't need a second surface
    // for the same three buttons.
    .remove(builtInExtensions.FloatingTextFormat)
  return c
}) satisfies (props: RichTextEditorProps) => React.JSX.Element

/**
 * Returns a `FieldAdminConfig` that opts a single richText field into the
 * minimal editor. Drop into a `CollectionAdminConfig.fields` map, keyed by
 * the schema field's name.
 *
 * @example
 * ```ts
 * // apps/webapp/byline/collections/content-types/publications/admin.tsx
 * import { minimalRichTextAdmin } from '../../../fields/richtext/lexical-richtext-minimal-admin.jsx'
 *
 * fields: {
 *   title: minimalRichTextAdmin(),
 * }
 * ```
 */
export function minimalRichTextAdmin(): FieldAdminConfig {
  return {
    editor: LexicalRichTextMinimal,
  }
}
