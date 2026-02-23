import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'

import { Docs, DocsAdmin } from './byline/collections/docs/index.js'
import { Media, MediaAdmin } from './byline/collections/media/index.js'
import { News, NewsAdmin } from './byline/collections/news/index.js'
import { Pages, PagesAdmin } from './byline/collections/pages/index.js'

export const config: ClientConfig = {
  serverURL: 'http://localhost:5173/',
  i18n: {
    interface: {
      defaultLocale: 'en',
      locales: ['en', 'es'],
    },
    content: {
      defaultLocale: 'en',
      locales: ['en', 'es'],
    },
  },
  collections: [Docs, Media, News, Pages],
  admin: [DocsAdmin, MediaAdmin, NewsAdmin, PagesAdmin],
}

defineClientConfig(config)
