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
 *   - `LexicalRichTextAi` — a React component (the AI-enabled editor).
 *     Register globally in `apps/webapp/byline/admin.config.ts` under
 *     `fields.richText.editor` to AI-enable every richtext field.
 *   - `aiRichTextAdmin()` — a `FieldAdminConfig` factory. Drop into a
 *     collection's `fields` map in `<collection>/admin.tsx` to opt one
 *     field into the AI editor without changing the global registration.
 *
 * Pairs with a plain `{ type: 'richText' }` entry on the schema side —
 * schema files must stay React-free and tsx-loadable.
 *
 * See `docs/FIELD-API.md` for the schema-vs-admin model.
 */

import { useEffect } from 'react'

import { AiPluginLexical, TOGGLE_AI_DRAWER_COMMAND } from '@byline/ai/plugins/lexical'
import type { FieldAdminConfig, RichTextEditorProps } from '@byline/core'
import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'
import { useToolbarExtensions } from '@byline/richtext-lexical/toolbar-extensions'
import { AiIcon } from '@byline/ui/react'

/**
 * Host-side glue between `@byline/ai`'s Lexical plugin and
 * `@byline/richtext-lexical`'s toolbar-extensions API.
 *
 * The plugin (`AiPluginLexical`) only ships the drawer/panel and a
 * `TOGGLE_AI_DRAWER_COMMAND` command; it does NOT register a toolbar
 * button itself, because the toolbar API lives in the editor adapter
 * (which the plugin doesn't depend on). This wrapper closes that gap:
 *
 *   - Registers a single toolbar icon under the canonical
 *     `toolbar-item spaced` class so it inherits the existing button
 *     styling. Clicking dispatches `TOGGLE_AI_DRAWER_COMMAND` on the
 *     root editor, which the plugin's listener toggles the drawer on.
 *   - Renders `<AiPluginLexical />` as a sibling so the drawer mounts
 *     in the same composer context the toolbar registration uses.
 *
 * Must render inside the `LexicalComposer` tree — that's what
 * `featureAfterEditor` already guarantees.
 */
function AiPluginLexicalWithToolbar(): React.JSX.Element {
  const { register, rootEditor } = useToolbarExtensions()

  useEffect(() => {
    return register({
      id: 'ai-toolbar-button',
      // Push to the end of the toolbar (alongside other "auxiliary"
      // buttons that ship with higher orders).
      order: 100_001,
      node: (
        <button
          type="button"
          className="toolbar-item spaced"
          aria-label="Toggle AI assistant"
          onClick={() => {
            rootEditor.dispatchCommand(TOGGLE_AI_DRAWER_COMMAND, undefined)
          }}
        >
          <AiIcon />
        </button>
      ),
    })
  }, [register, rootEditor])

  return <AiPluginLexical />
}

/**
 * AI-enabled wrapper around `@byline/richtext-lexical`'s `RichTextField`.
 *
 * Injects `<AiPluginLexicalWithToolbar />` into `featureAfterEditor`,
 * which (a) registers the toolbar icon via the toolbar-extensions
 * context and (b) renders the AI drawer. Authentication for the
 * underlying AI endpoint is enforced by the `executeAiInstruction`
 * server function in `@byline/host-tanstack-start`, wired by
 * `<BylineAiAdminProvider>` inside the admin layout.
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
export function LexicalRichTextAi(props: RichTextEditorProps): React.JSX.Element {
  return (
    <LexicalRichTextField
      {...props}
      featureAfterEditor={[<AiPluginLexicalWithToolbar key="ai-plugin" />]}
    />
  )
}

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
