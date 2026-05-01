/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The webapp's *public-read* `BylineClient` singleton.
 *
 * Configured with `actor: null` and `readMode: 'published'` so it only
 * surfaces published content; `assertActorCanPerform` permits the null
 * actor exactly on read paths whose `readMode === 'published'`. Every
 * non-admin server fn that reads documents through `@byline/client` should
 * route through this helper so the per-instance `collectionRecordCache`
 * is amortised across the whole CMS.
 *
 * The admin counterpart lives in
 * `@byline/host-tanstack-start/integrations/byline-client` —
 * `getAdminBylineClient` resolves an authenticated `RequestContext` from
 * session cookies on every call.
 */

import { createRequestContext } from '@byline/auth'
import { type BylineClient, createBylineClient } from '@byline/client'
import { getServerConfig } from '@byline/core'

let cachedClient: BylineClient | undefined

export function getPublicBylineClient(): BylineClient {
  if (cachedClient) return cachedClient
  cachedClient = createBylineClient({
    config: getServerConfig(),
    requestContext: () => createRequestContext({ readMode: 'published' }),
  })
  return cachedClient
}
