/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Registers Byline's admin config (collection admin UI configs,
 * field editors, i18n, routes) in the current module graph. The `_byline`
 * route registers it from two complementary points: a dynamic import in
 * `route.tsx` covers child loaders, while the side-effect import in
 * `route.lazy.tsx` covers component render and initial hydration. Keeping
 * both imports behind `_byline/*` keeps the admin graph off public routes.
 *
 * TanStack Start's server entry (`src/server.ts`) and SSR rendering context
 * run in separate Vite environments. Importing this file from `src/server.ts`
 * would therefore NOT propagate the
 * registration into the SSR render module graph.
 */

import type { AdminConfig } from '@byline/core'
import { defineAdminConfig } from '@byline/core'

import { FAQBlockAdmin } from './blocks/faq-block.admin.js'
import { PhotoBlockAdmin } from './blocks/photo-block.admin.js'
import { QuoteBlockAdmin } from './blocks/quote-block.admin.js'
import { DocsAdmin } from './collections/docs/admin.js'
import { collections } from './collections/index.js'
import { MediaAdmin } from './collections/media/admin.js'
import { NewsAdmin } from './collections/news/admin.js'
import { NewsCategoriesAdmin } from './collections/news-categories/admin.js'
import { PagesAdmin } from './collections/pages/admin.js'
import { LexicalRichTextAi } from './fields/richtext/lexical-richtext-ai.js'
import { i18n } from './i18n.js'
import { routes } from './routes.js'
import { SiteSettingsAdmin } from './singletons/site-settings/admin.js'

export const config: AdminConfig = {
  // Shared locale definitions and the complete admin translation registry.
  // Keeping this identical to the server config prevents admin forms from
  // offering locales the document lifecycle does not accept.
  i18n,
  // Canonical admin, sign-in, and reserved API paths. This is the same
  // client-safe object supplied to the server config and public facade.
  routes,
  // Server-safe collection schemas. Presentation modules stay in `admin`
  // below so importing this tuple elsewhere does not pull React into a
  // server-only or public-client graph.
  collections,
  // Dashboard grouping. `docs`, `news`, and `pages` deliberately declare no
  // group — they render in the leading ungrouped band above these headings,
  // which is what an installation gets while it is adopting groups gradually.
  collectionGroups: [
    { name: 'media', label: 'Media' },
    { name: 'taxonomy', label: 'Taxonomies' },
    { name: 'settings', label: 'Settings' },
  ],
  // Per-collection presentation config: labels, columns, widgets, and other
  // admin-only behavior. Every entry corresponds to one schema in
  // `collections`; array order supplies the ungrouped dashboard order.
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin, NewsCategoriesAdmin, SiteSettingsAdmin],
  // Per-block admin config, keyed by blockType — applies wherever the block
  // renders. Quote/Photo opt a block richtext field into the minimal
  // editor (extension half of `lexicalRichTextMinimal`, see the block
  // schema files) while the site-wide registration below stays AI-enabled.
  // FAQ is the dotted schema-path reference: its `faq.answer` key reaches
  // the answer field inside the block's array.
  blockAdmin: [QuoteBlockAdmin, PhotoBlockAdmin, FAQBlockAdmin],
  // Site-wide defaults for field editors. Collection-specific field admin
  // config can still override these choices.
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

// Validate the presentation registries, canonicalize routes, and register the
// resolved config in this admin module graph. The call is intentionally a
// side effect; admin routes retrieve the result through `getAdminConfig()`.
defineAdminConfig(config)
