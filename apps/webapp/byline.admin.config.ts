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
 */

import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'

import { Docs, DocsAdmin } from './byline/collections/docs/index.js'
import { Media, MediaAdmin } from './byline/collections/media/index.js'
import { News, NewsAdmin } from './byline/collections/news/index.js'
import { Pages, PagesAdmin } from './byline/collections/pages/index.js'
import { i18n } from './byline/i18n.js'

export const config: ClientConfig = {
  serverURL: 'http://localhost:5173/',
  i18n,
  collections: [Docs, News, Pages, Media],
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin],
}

defineClientConfig(config)
