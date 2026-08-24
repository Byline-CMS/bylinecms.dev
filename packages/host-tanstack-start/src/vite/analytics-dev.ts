/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Plugin } from 'vite'

import { serveAnalyticsAgent } from '../integrations/serve-analytics-agent.js'

/**
 * Complete the first-party analytics transport during Vite development.
 *
 * Browser script requests carry `Sec-Fetch-Dest: script`, which Vite routes
 * into its module pipeline before TanStack Start can serve the agent route.
 * This plugin serves the agent directly. The application event route remains
 * responsible for its development identity because POST server routes can
 * bypass Vite's ordinary middleware chain. Production continues to use the
 * application-owned agent route.
 */
export function bylineAnalyticsDev(
  options: {
    /** Public path that serves the standalone agent. */
    agentPath?: string
  } = {}
): Plugin {
  const agentPath = options.agentPath ?? '/b.js'

  return {
    name: 'byline:analytics-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?', 1)[0]

        if (request.method === 'GET' && pathname === agentPath) {
          try {
            const agentResponse = serveAnalyticsAgent()
            response.statusCode = agentResponse.status
            agentResponse.headers.forEach((value, name) => {
              response.setHeader(name, value)
            })
            response.end(await agentResponse.text())
          } catch (error) {
            next(error)
          }
          return
        }

        next()
      })
    },
  }
}
