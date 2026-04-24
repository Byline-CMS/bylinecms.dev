/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SessionProvider } from '@byline/auth'

import type { SlugifierFn } from '../utils/slugify.js'
import type { CollectionAdminConfig } from './admin-types.js'
import type { CollectionDefinition } from './collection-types.js'
import type { IDbAdapter } from './db-types.js'
import type { IStorageProvider } from './storage-types.js'

export type DbAdapterFn = (args: { connectionString: string }) => IDbAdapter

/**
 * Common configuration shared by the server and client. Contains only
 * serializable, framework-agnostic properties — no React components, no
 * database adapters, no storage providers.
 */
export interface BaseConfig {
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
}

/**
 * Client-side configuration. Extends BaseConfig with admin UI presentation
 * config (React components, formatters, column definitions, etc.).
 *
 * Used by `defineClientConfig()` and consumed by admin UI routes.
 */
export interface ClientConfig extends BaseConfig {
  /** Admin UI configuration for collections (client-side only). */
  admin?: CollectionAdminConfig[]
}

/**
 * Server-side configuration. Extends BaseConfig with database and storage
 * adapters. Deliberately does NOT extend ClientConfig — the server has no
 * knowledge of React components or admin UI presentation logic.
 */
export interface ServerConfig extends BaseConfig {
  db: IDbAdapter
  /**
   * Site-wide default storage provider for upload-enabled collections.
   *
   * This is the fallback used when a collection's own `UploadConfig.storage`
   * is not set. Individual collections can override this by specifying
   * `storage` inside their `upload` config block.
   *
   * Resolution order:
   *   1. `collection.upload.storage`  — collection-level override
   *   2. `ServerConfig.storage`        — site-wide default
   *   3. 500 error if neither is set
   *
   * @example
   * ```ts
   * import { localStorageProvider } from '@byline/storage-local'
   * storage: localStorageProvider({ uploadDir: './public/uploads', baseUrl: '/uploads' })
   * ```
   */
  storage?: IStorageProvider
  /**
   * Installation-wide slugifier used to derive `documentVersions.path`
   * from the field named by `CollectionDefinition.useAsPath`.
   *
   * Falls back to the default `slugify` from `@byline/core` when not set.
   * Must be pure and synchronous — it runs server-side at write time and
   * client-side for live form preview, and the two must agree on output.
   */
  slugifier?: SlugifierFn
  /**
   * Session provider for admin authentication. Optional in Phase 3 —
   * installations without a provider configured simply can't sign in
   * (sign-in / verify / refresh / revoke all require one); everything
   * else continues to work. Phase 5 wires the admin server-fn middleware
   * and will tighten this where authentication is required.
   *
   * The built-in `JwtSessionProvider` from `@byline/admin/auth` covers
   * the default case. Alternative providers can adapt Lucia, better-auth,
   * WorkOS, Clerk, or institutional SSO by implementing the
   * `SessionProvider` interface from `@byline/auth` — those adapters
   * should ship as separate packages rather than being added to
   * `@byline/admin`.
   *
   * @example
   * ```ts
   * import { JwtSessionProvider } from '@byline/admin/auth'
   * import { createAdminStore } from '@byline/db-postgres/auth'
   *
   * sessionProvider: new JwtSessionProvider({
   *   store: createAdminStore(drizzleDb),
   *   signingSecret: process.env.BYLINE_JWT_SECRET!,
   * })
   * ```
   */
  sessionProvider?: SessionProvider
}
