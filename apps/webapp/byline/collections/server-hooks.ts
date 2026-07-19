/** Server-only lifecycle hook registry. Imported only by server.config.ts. */
import type { ServerHooksConfig } from '@byline/core'

export const serverHooks = {
  collections: {
    docs: () => import('./docs/hooks.js'),
    news: () => import('./news/hooks.js'),
    'news-categories': () => import('./news-categories/hooks.js'),
    pages: () => import('./pages/hooks.js'),
  },
  // Deliberately comments out - as we'll use our default
  // <location|collection>/<slugified-base>-<suffix>.<ext> for this
  // collection. The rename hooks are there to test, and as an
  // example of storage hooks.
  // See docs/04-collections/06-file-media-uploads.md
  // uploads: {
  //   'media.image': () => import('./media/hooks.js'),
  // },
} satisfies ServerHooksConfig
