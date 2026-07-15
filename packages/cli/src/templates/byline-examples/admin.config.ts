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
import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'

// Import `lexicalEditor` instead of (or alongside) `RichTextField` if you
// want to register the editor with site-wide custom settings. See the
// commented `richText` block below for the exact shape.
// import { lexicalEditor } from '@byline/richtext-lexical'

import { collections } from './collections/index.js'
import { DocsAdmin } from './collections/docs/admin.js'
import { MediaAdmin } from './collections/media/admin.js'
import { NewsAdmin } from './collections/news/admin.js'
import { NewsCategoriesAdmin } from './collections/news-categories/admin.js'
import { PagesAdmin } from './collections/pages/admin.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

export const config: ClientConfig = {
  serverURL,
  i18n,
  routes,
  collections,
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin, NewsCategoriesAdmin],
  fields: {
    // Default registration — every `type: 'richText'` field gets the full
    // Lexical feature set unless overridden per-field via
    // `RichTextField.editorConfig` (see `byline/fields/lexical-richtext-compact.ts`
    // for the per-field pattern).
    richText: { editor: LexicalRichTextField },

    // ---------------------------------------------------------------------
    // Alternatively — register the editor with site-wide custom settings
    // and an edited extensions list. The `configure` callback receives a
    // fresh seed (default settings + the canonical extensions list), and
    // mutations are local to this call. Per-field `editorConfig`
    // continues to take precedence over whatever is baked in here.
    //
    // import {
    //   lexicalEditor,
    //   AdmonitionExtension,
    //   CodeHighlightExtension,
    //   TableExtension,
    // } from '@byline/richtext-lexical'
    //
    // richText: {
    //   editor: lexicalEditor((c) => {
    //     c.extensions
    //       .remove(TableExtension)
    //       .remove(CodeHighlightExtension)
    //       .remove(AdmonitionExtension)
    //     c.settings.placeholderText = 'Start writing...'
    //     return c
    //   }),
    // },
    // ---------------------------------------------------------------------
    //
    // Or — enable the AI assistant on every richtext field globally by
    // registering the `LexicalRichTextAi` editor. It is built with
    // `lexicalEditor((c) => c.extensions.add(AiLexicalExtension))`, so
    // the AI drawer mounts as a Lexical extension decorator and the
    // toolbar button arrives via the BylineToolbarExtension peer
    // contract. Server-side auth is provided by `executeAiInstruction`
    // via `<BylineAiAdminProvider>` in the admin layout.
    //
    // import { LexicalRichTextAi } from './fields/lexical-richtext-ai.js'
    // richText: { editor: LexicalRichTextAi },
    // ---------------------------------------------------------------------
  },
}

defineClientConfig(config)
