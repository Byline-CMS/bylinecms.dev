/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
