/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Registers Byline's client-side config (collection admin UI configs,
 * field editors, i18n, routes) in the current module graph. Imported as
 * a side-effect from `src/routes/__root.tsx` — that module runs in both
 * the SSR render and client module graphs, so a single import there
 * covers both contexts.
 *
 * In TanStack Start with Vite 6 the server entry (`src/server.ts`) and
 * the SSR rendering context run in separate Vite environments, so
 * importing this file from `src/server.ts` would NOT propagate the
 * registration into the SSR render module graph.
 */

import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'
import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'

// Import `lexicalEditor` instead of (or alongside) `RichTextField` if you
// want to register the editor with site-wide custom settings. See the
// commented `richText` block below for the exact shape.
// import { lexicalEditor } from '@byline/richtext-lexical'

import { Docs, DocsAdmin } from './collections/docs/index.js'
import { DocsCategories, DocsCategoriesAdmin } from './collections/docs-categories/index.js'
import { Media, MediaAdmin } from './collections/media/index.js'
import { News, NewsAdmin } from './collections/news/index.js'
import { NewsCategories, NewsCategoriesAdmin } from './collections/news-categories/index.js'
import { Pages, PagesAdmin } from './collections/pages/index.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

export const config: ClientConfig = {
  serverURL,
  i18n,
  routes,
  collections: [Docs, News, Pages, Media, DocsCategories, NewsCategories],
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin, DocsCategoriesAdmin, NewsCategoriesAdmin],
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
