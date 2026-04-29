/**
 * This module ensures Byline client config (including admin UI config) is
 * registered in the current module graph. Import this file as a side-effect
 * from any module that needs access to collection admin configurations.
 *
 * In TanStack Start with Vite 6, the server entry (server.ts) and the SSR
 * rendering context run in separate Vite environments. Side-effect imports
 * in server.ts do not propagate into the SSR render module graph, we
 * import this config in __root.tsx to ensure it's available in both contexts.
 *
 * Shared scalar values (`serverURL`, `i18n`, `routes`) come from
 * `byline.common.config.ts` so they're declared once and consumed by both
 * the server and admin entry points.
 */

import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'
import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'
// Import `lexicalEditor` instead of (or alongside) `RichTextField` if you
// want to register the editor with site-wide custom settings. See the
// commented `richText` block below for the exact shape.
// import { lexicalEditor } from '@byline/richtext-lexical'

import { Categories, CategoriesAdmin } from './byline/collections/categories/index.js'
import { Docs, DocsAdmin } from './byline/collections/docs/index.js'
import { Media, MediaAdmin } from './byline/collections/media/index.js'
import { News, NewsAdmin } from './byline/collections/news/index.js'
import { Pages, PagesAdmin } from './byline/collections/pages/index.js'
import { i18n, routes, serverURL } from './byline.common.config.js'

export const config: ClientConfig = {
  serverURL,
  i18n,
  routes,
  collections: [Docs, News, Pages, Media, Categories],
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin, CategoriesAdmin],
  fields: {
    // Default registration — every `type: 'richText'` field gets the full
    // Lexical feature set unless overridden per-field via
    // `RichTextField.editorConfig` (see `byline/fields/lexical-richtext-compact.ts`
    // for the per-field pattern).
    richText: { editor: LexicalRichTextField },

    // ---------------------------------------------------------------------
    // Alternatively — register the editor with site-wide custom settings.
    // The `configure` callback receives a deep clone of `defaultEditorConfig`,
    // so mutating it is safe. Per-field `editorConfig` continues to take
    // precedence over whatever is baked in here.
    //
    // richText: {
    //   editor: lexicalEditor((c) => {
    //     c.settings.options.tablePlugin = false
    //     c.settings.options.codeHighlightPlugin = false
    //     c.settings.options.admonitionPlugin = false
    //     c.settings.placeholderText = 'Start writing...'
    //     return c
    //   }),
    // },
    // ---------------------------------------------------------------------
  },
}

defineClientConfig(config)
