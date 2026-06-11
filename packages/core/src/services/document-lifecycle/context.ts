/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import type { CollectionDefinition, IDbAdapter, IStorageProvider } from '../../@types/index.js'
import type { BylineLogger } from '../../lib/logger.js'
import type { SlugifierFn } from '../../utils/slugify.js'

// ---------------------------------------------------------------------------
// Context shared by all lifecycle functions
// ---------------------------------------------------------------------------

/**
 * The shared context every lifecycle function requires. Built once per
 * request by the API route layer and passed through.
 */
export interface DocumentLifecycleContext {
  /** The database adapter returned by `getServerConfig().db`. */
  db: IDbAdapter
  /** The resolved `CollectionDefinition` (includes `hooks`). */
  definition: CollectionDefinition
  /** The database-level collection row ID. */
  collectionId: string
  /**
   * The collection's current schema version. Stamped onto every
   * `documentVersions` row written during the lifecycle call so that
   * Phase-2 in-memory migration can later resolve each document against
   * the shape it was authored under. Callers resolve this from the core
   * registry (`core.getCollectionRecord(path).version`).
   */
  collectionVersion: number
  /** The collection `path` string (e.g. `'docs'`, `'news'`). */
  collectionPath: string
  /**
   * Storage provider for this collection. Required when the collection
   * has any upload-capable image/file field, so that the original files
   * and their persisted variants can be cleaned up on document deletion.
   *
   * Resolved by the route layer as:
   *   `field.upload?.storage ?? serverConfig.storage`
   *
   * Optional — callers whose collections have no upload-capable fields
   * are unaffected.
   */
  storage?: IStorageProvider
  /** Structured logger instance. Provided via the DI registry. */
  logger: BylineLogger
  /**
   * The default content locale (e.g. `'en'`). Used to anchor `path`
   * derivation: the slugifier always runs against the default-locale
   * source value, and creating a brand-new document in any other locale
   * is rejected.
   *
   * Sourced by callers from `ServerConfig.i18n.content.defaultLocale`.
   */
  defaultLocale: string
  /**
   * Installation slugifier. When omitted, the lifecycle falls back to
   * the default `slugify` exported from `@byline/core`.
   */
  slugifier?: SlugifierFn
  /**
   * Request-scoped context carrying the authenticated actor, request id,
   * and related per-request metadata.
   *
   * Plumbing only in Phase 0 of the auth roadmap — present on the context
   * so every lifecycle service can accept and forward it, but no ability
   * assertions are performed yet. Phase 4 turns enforcement on: lifecycle
   * entry points will call `context.requestContext?.actor?.assertAbility(...)`
   * before any storage mutation.
   *
   * Optional so that internal-tooling callers (seed scripts, migration
   * tools) continue to compile. Production write paths always supply it
   * — `assertActorCanPerform` runs at every lifecycle entry and rejects
   * a missing context.
   *
   * See docs/AUTHN-AUTHZ.md.
   */
  requestContext?: RequestContext
}
