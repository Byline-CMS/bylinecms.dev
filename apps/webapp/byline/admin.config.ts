/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Registers Byline's client-side config (collection admin UI configs,
 * field editors, i18n, routes) in the current module graph. The `_byline`
 * route registers it from two complementary points: a dynamic import in
 * `route.tsx` covers child loaders, while the side-effect import in
 * `route.lazy.tsx` covers component render and initial hydration. Keeping
 * both imports behind `_byline/*` keeps the admin graph off public routes.
 *
 * In TanStack Start with Vite 6 the server entry (`src/server.ts`) and
 * the SSR rendering context run in separate Vite environments, so
 * importing this file from `src/server.ts` would NOT propagate the
 * registration into the SSR render module graph.
 */

import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'

import { Docs, DocsAdmin } from './collections/docs/index.js'
import { Media, MediaAdmin } from './collections/media/index.js'
import { News, NewsAdmin } from './collections/news/index.js'
import { NewsCategories, NewsCategoriesAdmin } from './collections/news-categories/index.js'
import { Pages, PagesAdmin } from './collections/pages/index.js'
import { LexicalRichTextAi } from './fields/lexical-richtext-ai.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

export const config: ClientConfig = {
  serverURL,
  i18n,
  routes,
  collections: [Docs, News, Pages, Media, NewsCategories],
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin, NewsCategoriesAdmin],
  fields: {
    // Site-wide registration of the AI-enabled editor on every richtext
    // field. `LexicalRichTextAi` is built with
    // `lexicalEditor((c) => c.extensions.add(AiLexicalExtension))`, so the
    // AI drawer mounts as a Lexical extension decorator and the toolbar
    // button arrives via the BylineToolbarExtension peer contract.
    // Server-side auth is provided by `executeAiInstruction` via
    // `<BylineAiAdminProvider>` in the admin layout.
    //
    // It also removes `FloatingTextFormatExtension`, so the floating
    // text-format popover stays suppressed on the root editor. The popover
    // still mounts inside nested composers (inline-image captions,
    // admonition content) where `<FloatingTextFormatToolbarPlugin />` is
    // rendered as a direct child of the `LexicalNestedComposer` — the AI
    // assistant is intentionally NOT available in those nested editors.
    richText: { editor: LexicalRichTextAi },

    // ---------------------------------------------------------------------
    // Alternatively — register the editor without the AI assistant, only
    // suppressing the floating text-format popover on the root editor.
    // Import from the light `/config` subpath and toggle built-ins by name
    // so the registration stays free of the editor runtime:
    //
    // import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'
    //
    // richText: {
    //   editor: lexicalEditor((c) => {
    //     c.extensions.remove(builtInExtensions.FloatingTextFormat)
    //     return c
    //   }),
    // },
    // ---------------------------------------------------------------------
    //
    // Or — register the editor with further site-wide custom settings and
    // an edited extensions list. The `configure` callback receives a fresh
    // seed (default settings + the canonical extensions list), and
    // mutations are local to this call. Per-field `editorConfig` continues
    // to take precedence over whatever is baked in here.
    //
    // import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'
    //
    // richText: {
    //   editor: lexicalEditor((c) => {
    //     c.extensions
    //       .remove(builtInExtensions.Table)
    //       .remove(builtInExtensions.CodeHighlight)
    //       .remove(builtInExtensions.Admonition)
    //     c.settings.placeholderText = 'Start writing...'
    //     return c
    //   }),
    // },
    // ---------------------------------------------------------------------
  },
}

defineClientConfig(config)
