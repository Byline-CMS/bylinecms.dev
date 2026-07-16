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
 * *minimal* Lexical `editorConfig` (settings only) into the schema. Pure
 * data: no React, no CSS — schema files must stay tsx-loadable for
 * seeds (see `byline/server.config.ts`).
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Minimal = inline text formatting ONLY (bold / italic / underline …)
 * ──────────────────────────────────────────────────────────────────────────
 * This is a **two-sided** definition, split by what each side is allowed
 * to express:
 *
 *  1. **This schema helper** turns off every settings-controlled toolbar
 *     affordance (block-format dropdown, alignment, inline code, undo/redo,
 *     markdown toggle + shortcuts). Settings are JSON-safe, so they can be
 *     baked into the schema.
 *  2. **`minimalRichTextAdmin()`** (see `lexical-richtext-minimal-admin.tsx`)
 *     removes the node *extensions* — Admonition, InlineImage, Layout,
 *     HorizontalRule, Table, embeds, links. The toolbar's "Insert" dropdown
 *     is composed from items those extensions contribute (the
 *     `BylineToolbarExtension` peer contract) and hides itself entirely
 *     when nothing contributes — there is deliberately no settings flag for
 *     it. Extension references are not JSON-safe and would break tsx-loaded
 *     seeds, which is why removal lives on the admin side, registered
 *     per-field via `FieldAdminConfig.editor`.
 *
 * Always pair this helper with `minimalRichTextAdmin()` in the collection's
 * `admin.tsx` `fields` map — the schema half alone still leaves the Insert
 * menu (and link button) in place.
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
   * Optional callback to further customise the minimal defaults. Receives a
   * mutable copy of the minimal settings; mutate and return, or return a new
   * object. Runs after the minimal preset is applied, so callers can
   * re-enable specific options for a particular field without re-listing
   * the full set.
   *
   * The minimal preset only touches `settings`. Do not assign extensions
   * here — schema-side `editorConfig` must remain JSON-safe.
   */
  configure?: (config: EditorConfig) => EditorConfig
}

type WithOverride<O, K extends string, V, D> = O extends { [P in K]: V } ? O[K] : D

type MinimalRichTextField<Opts extends Options> = Omit<
  RichTextField,
  'name' | 'type' | 'editorConfig'
> &
  Omit<Opts, 'configure'> & {
    name: WithOverride<Opts, 'name', string, 'richText'>
    type: 'richText'
    editorConfig: EditorConfig
  }

/**
 * Minimal preset — everything settings-controlled goes off, leaving only
 * the inline format buttons (bold / italic / underline). Suitable for
 * single-line rich titles and strap-lines where structural nodes make no
 * sense. Markdown shortcuts are disabled too, so `# `, `- `, `> ` etc.
 * cannot smuggle block nodes into the value as you type.
 */
function applyMinimalPreset(config: EditorConfig): EditorConfig {
  const o = config.settings.options
  o.textAlignment = false
  o.textStyle = false // hides the block-format dropdown (headings / lists / quote)
  o.inlineCode = false
  o.undoRedo = false
  o.markdownToggle = false
  o.markdownShortcutPlugin = false
  return config
}

/**
 * Returns a `RichTextField` with minimal toolbar settings baked into
 * `editorConfig`. Pair with `minimalRichTextAdmin()` on the admin side to
 * also strip the node extensions (Insert menu, link button).
 *
 * @example
 * ```ts
 * // schema.ts
 * fields: [
 *   lexicalRichTextMinimal({ name: 'title', label: 'Title', localized: true }),
 * ]
 *
 * // admin.tsx
 * fields: {
 *   title: minimalRichTextAdmin(),
 * }
 * ```
 */
export function lexicalRichTextMinimal<const Opts extends Options>(
  options: Opts = {} as Opts
): MinimalRichTextField<Opts> {
  const { configure, ...rest } = options
  const base = applyMinimalPreset(structuredClone(defaultEditorConfig))
  const editorConfig = configure ? configure(base) : base

  return {
    name: 'richText',
    label: 'RichText',
    ...rest,
    type: 'richText',
    editorConfig,
  } as MinimalRichTextField<Opts>
}
