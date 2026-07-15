/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Registers Byline's client-side config (collection admin UI configs,
 * field editors, i18n, routes) in the current module graph. The `_byline`
 * route registers it from two complementary points: a dynamic import in
 * `route.tsx` covers child loaders, while the side-effect import in
 * `route.lazy.tsx` covers component render and initial hydration. Keeping
 * both imports behind `_byline/*` keeps the admin graph off public routes.
 *
 * This is the minimal scaffold: no example collections registered. Add
 * schemas to `collections/index.ts` and presentation configs to `admin`.
 */

import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'
import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'

import { collections } from './collections/index.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

export const config: ClientConfig = {
  serverURL,
  i18n,
  routes,
  collections,
  admin: [],
  fields: {
    richText: { editor: LexicalRichTextField },
  },
}

defineClientConfig(config)
