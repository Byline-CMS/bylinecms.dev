/** Server-only lifecycle hook registry. Imported only by server.config.ts. */
import type { ServerHooksConfig } from '@byline/core'

export const serverHooks = {
  collections: {
    docs: () => import('./docs/hooks.js'),
    news: () => import('./news/hooks.js'),
    'news-categories': () => import('./news-categories/hooks.js'),
    pages: () => import('./pages/hooks.js'),
  },
  uploads: {
    'media.image': () => import('./media/hooks.js'),
  },
} satisfies ServerHooksConfig
