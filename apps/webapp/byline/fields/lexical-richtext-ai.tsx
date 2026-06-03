/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * **Admin-side module.** Exports two things — both consumed admin-side,
 * never from a schema:
 *
 *   - `LexicalRichTextAi` — a `RichTextEditorComponent` that registers
 *     the AI assistant by adding `AiLexicalExtension` to the editor's
 *     extension graph. Register globally in
 *     `apps/webapp/byline/admin.config.ts` under
 *     `fields.richText.editor` to AI-enable every richtext field.
 *   - `aiRichTextAdmin()` — a `FieldAdminConfig` factory. Drop into a
 *     collection's `fields` map in `<collection>/admin.tsx` to opt one
 *     field into the AI editor without changing the global registration.
 *
 * Pairs with a plain `{ type: 'richText' }` entry on the schema side —
 * schema files must stay React-free and tsx-loadable.
 *
 * See `docs/FIELDS.md` for the schema-vs-admin model.
 */

import { AiLexicalExtension } from '@byline/ai/plugins/lexical'
import type { FieldAdminConfig, RichTextEditorProps } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

/**
 * AI-enabled wrapper around `@byline/richtext-lexical`'s editor.
 *
 * Composes a `lexicalEditor()` with `AiLexicalExtension` added to the
 * extensions graph. The extension contributes a toolbar button via the
 * `BylineToolbarExtension` peer-dependency contract and mounts the AI
 * drawer via `ReactExtension.decorators` — no `featureAfterEditor`, no
 * React-context registry hop.
 *
 * **Global** opt-in — register in `apps/webapp/byline/admin.config.ts`:
 *
 * ```ts
 * fields: {
 *   richText: { editor: LexicalRichTextAi },
 * }
 * ```
 *
 * **Per-field** opt-in — see `aiRichTextAdmin()` below.
 */
export const LexicalRichTextAi = lexicalEditor((c) => {
  c.extensions.add(AiLexicalExtension).remove(builtInExtensions.FloatingTextFormat)
  return c
}) satisfies (props: RichTextEditorProps) => React.JSX.Element

/**
 * Returns a `FieldAdminConfig` that opts a single richText field into
 * the AI-enabled editor (`LexicalRichTextAi`) without changing the
 * site-wide registration. Drop into a `CollectionAdminConfig.fields`
 * map, keyed by the schema field's name.
 *
 * Lives on the admin side (alongside `aiTextFieldAdmin` /
 * `aiTextAreaFieldAdmin`) so the schema graph stays React-free and
 * tsx-loadable — the server bootstrap in `byline/server.config.ts`
 * must be able to import collection schemas without pulling in the
 * Lexical editor and the AI plugin.
 *
 * @example
 * ```ts
 * // apps/webapp/byline/collections/news/admin.tsx
 * import { aiRichTextAdmin } from '../../fields/lexical-richtext-ai.js'
 *
 * fields: {
 *   content: aiRichTextAdmin(),
 * }
 * ```
 */
export function aiRichTextAdmin(): FieldAdminConfig {
  return {
    editor: LexicalRichTextAi,
  }
}
