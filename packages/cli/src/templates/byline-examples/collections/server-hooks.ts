/** Server-only lifecycle hook registry. Imported only by server.config.ts. */
import type { ServerHooksConfig } from '@byline/core'

export const serverHooks = {
  collections: {
    docs: () => import('./docs/hooks.js'),
  },
} satisfies ServerHooksConfig
