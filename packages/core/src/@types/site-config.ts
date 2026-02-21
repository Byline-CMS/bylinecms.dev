/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionAdminConfig } from './admin-types.js'
import type { CollectionDefinition } from './collection-types.js'
import type { IDbAdapter } from './db-types.js'

export type DbAdapterFn = (args: { connectionString: string }) => IDbAdapter

export interface ClientConfig {
  serverURL: string
  i18n: {
    interface: {
      defaultLocale: string
      locales: string[]
    }
    content: {
      defaultLocale: string
      locales: string[]
    }
  }
  collections: CollectionDefinition[]
  /** Admin UI configuration for collections (client-side only). */
  admin?: CollectionAdminConfig[]
}

export interface ServerConfig extends ClientConfig {
  db: IDbAdapter
}
