/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ANALYTICS_AGENT_SOURCE } from '@byline/analytics-agent/source'

export function serveAnalyticsAgent(): Response {
  return new Response(ANALYTICS_AGENT_SOURCE, {
    headers: {
      'cache-control': 'public, max-age=3600, must-revalidate',
      'content-type': 'text/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}
