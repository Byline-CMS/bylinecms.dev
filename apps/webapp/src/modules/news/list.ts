/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News list server fn.
 *
 * Builds (and caches) a *public-read* `BylineClient` — `actor: null`,
 * `readMode: 'published'` — and exposes a filterable query over the `news`
 * collection. `assertActorCanPerform` permits the null actor only on
 * read paths whose `readMode === 'published'`, which is exactly what
 * `@byline/client` defaults to. The optional `category` input is matched
 * against the related news-category's `path` slug.
 *
 * This is the first non-admin server fn that goes through `@byline/client`,
 * so the public client is constructed inline here. If a second public
 * read path lands, lift the singleton into a shared module alongside the
 * admin one in `@byline/host-tanstack-start/integrations/byline-client`.
 */

import { createServerFn } from '@tanstack/react-start'

import { createRequestContext } from '@byline/auth'
import { type BylineClient, createBylineClient, type FindResult } from '@byline/client'
import { getServerConfig } from '@byline/core'

let cachedClient: BylineClient | undefined

function getPublicBylineClient(): BylineClient {
  if (cachedClient) return cachedClient
  const config = getServerConfig()
  cachedClient = createBylineClient({
    db: config.db,
    collections: config.collections,
    storage: config.storage,
    defaultLocale: config.i18n?.content?.defaultLocale,
    requestContext: () => createRequestContext({ readMode: 'published' }),
  })
  return cachedClient
}

export interface NewsListInput {
  category?: string
  page?: number
  pageSize?: number
  locale?: string
}

interface ResolvedNewsListInput {
  category: string | undefined
  page: number
  pageSize: number
  locale: string | undefined
}

export const getNewsListFn = createServerFn({ method: 'GET' })
  .inputValidator((input: NewsListInput | undefined): ResolvedNewsListInput => ({
    category: input?.category || undefined,
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? 12,
    locale: input?.locale,
  }))
  .handler(async (ctx): Promise<FindResult> => {
    const data = ctx.data as ResolvedNewsListInput
    const client = getPublicBylineClient()

    return client.collection('news').find({
      where: data.category ? { category: { path: data.category } } : undefined,
      sort: { publishedOn: 'desc' },
      // Default-projection populate pulls the relation's `displayField`
      // (`name` for news-categories) so the card grid has a label without
      // a second round-trip.
      populate: { category: true, featureImage: true },
      page: data.page,
      pageSize: data.pageSize,
      locale: data.locale,
    })
  })
