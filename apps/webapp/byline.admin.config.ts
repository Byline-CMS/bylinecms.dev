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
}

defineClientConfig(config)
