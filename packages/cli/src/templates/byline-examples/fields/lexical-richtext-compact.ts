/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * **Schema-side helper.** Returns a `RichTextField` schema — drop into a
 * collection's `fields` array in `<collection>/schema.ts`. Bakes a
 * compact Lexical `editorConfig` (settings only) into the schema. Pure
 * data: no React, no CSS — schema files must stay tsx-loadable for
 * seeds (see `byline/server.config.ts`).
 *
 * **Constraint** — `editorConfig` baked into a schema can only override
 * **settings** (placeholder, toolbar UI flags, `embedRelationsOnSave`).
 * Extension references (TableExtension, AdmonitionExtension, etc.) are
 * not JSON-safe and would break tsx-loaded seeds; per-field extension
 * removal goes through a client-side wrapper component registered via
 * `FieldAdminConfig.editor`.
 *
 * See `docs/FIELDS.md` for the full schema-vs-admin model.
 */

import type { RichTextField } from '@byline/core'
// Import from `/server` (data-only) rather than the package root so this
// schema helper stays tsx-loadable. The root barrel evaluates `RichTextField`
// / `EditorField` and their CSS imports, which would break seeds that load
// any collection schema using this factory.
import { defaultEditorConfig, type EditorConfig } from '@byline/richtext-lexical/server'

type Options = Partial<Omit<RichTextField, 'type' | 'editorConfig'>> & {
  /**
   * Optional callback to further customise the compact defaults. Receives a
   * mutable copy of the compact settings; mutate and return, or return a new
   * object. Runs after the compact preset is applied, so callers can re-enable
   * specific options for a particular field without re-listing the full set.
   *
   * The compact preset only touches `settings`. Do not assign extensions
   * here — schema-side `editorConfig` must remain JSON-safe.
   */
  configure?: (config: EditorConfig) => EditorConfig
}

/**
 * Compact preset — disables secondary toolbar UI (text alignment,
 * inline-code, undo/redo, text style) for inline body copy like image
 * captions, byline strap-lines, or compact form fields. Bold / italic /
 * link editing remain on.
 *
 * To narrow the *extension* set per-field — drop tables, lists, embeds,
 * the floating format toolbar, the table action menu — register a
 * `LexicalRichTextCompact` wrapper component via `FieldAdminConfig.editor`.
 * Extension references aren't safe to bake into schemas, and floating
 * UIs are now extension-presence controlled rather than settings-controlled.
 */
function applyCompactPreset(config: EditorConfig): EditorConfig {
  const o = config.settings.options
  o.textAlignment = false
  o.textStyle = false
  o.inlineCode = false
  o.undoRedo = false
  return config
}

/**
 * Returns a `RichTextField` with reduced toolbar settings baked into
 * `editorConfig`. Use this for caption-style or otherwise constrained
 * rich-text fields where the full editor toolbar would be inappropriate.
 *
 * @example
 * ```ts
 * fields: [
 *   lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),
 *   // Compact + custom placeholder for one field:
 *   lexicalRichTextCompact({
 *     name: 'summary',
 *     label: 'Summary',
 *     configure: (c) => {
 *       c.settings.placeholderText = 'One sentence summary…'
 *       return c
 *     },
 *   }),
 * ]
 * ```
 */
export function lexicalRichTextCompact(options: Options = {}): RichTextField {
  const { configure, ...rest } = options
  const base = applyCompactPreset(structuredClone(defaultEditorConfig))
  const editorConfig = configure ? configure(base) : base

  return {
    name: 'richText',
    label: 'RichText',
    ...rest,
    type: 'richText',
    editorConfig,
  }
}
