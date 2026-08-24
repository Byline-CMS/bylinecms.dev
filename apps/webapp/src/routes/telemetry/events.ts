/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/telemetry/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { createAnalyticsEventHandler, localAnalyticsRequestContext, trustedAnalyticsHeaders },
          { getRequestIP },
        ] = await Promise.all([
          import('@byline/host-tanstack-start/integrations/analytics-events'),
          import('@tanstack/react-start/server'),
        ])
        return createAnalyticsEventHandler({
          // This webapp's production deployment uses a trusted origin proxy.
          // Other hosts can resolve request context from their platform or
          // direct connection instead; the analytics contract assumes neither
          // nginx nor Cloudflare. We intentionally do not trust X-Forwarded-For.
          resolveRequestContext: trustedAnalyticsHeaders({
            clientIpHeader: 'x-byline-client-ip',
            countryHeader: 'x-byline-client-country',
            // A direct loopback connection makes built-app testing work under
            // both `pnpm preview` and `pnpm start`. Public production requests
            // cannot select this fallback through request headers.
            fallback: localAnalyticsRequestContext({
              resolveClientIp: () => getRequestIP(),
              developmentFallbackClientIp: import.meta.env.DEV ? 'vite-development' : undefined,
            }),
          }),
        })(request)
      },
    },
  },
})
