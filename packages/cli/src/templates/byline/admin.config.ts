/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Registers Byline's client-side config (collection admin UI configs,
 * field editors, i18n, routes) in the current module graph. Imported as
 * a side-effect from `src/routes/_byline/route.lazy.tsx` so registration
 * fires only when a `_byline/*` URL matches — keeping the Lexical
 * editor module graph out of public-route bundles entirely.
 *
 * This is the minimal scaffold: no example collections registered. Add
 * collection schemas + admin configs to the `collections` and `admin`
 * arrays as you create them.
 */

import type { ClientConfig } from '@byline/core'
import { defineClientConfig } from '@byline/core'
import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'

import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

export const config: ClientConfig = {
  serverURL,
  i18n,
  routes,
  collections: [],
  admin: [],
  fields: {
    richText: { editor: LexicalRichTextField },
  },
}

defineClientConfig(config)
