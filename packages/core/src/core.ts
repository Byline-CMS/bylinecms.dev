/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type AbilityDescriptor, AbilityRegistry, type SessionProvider } from '@byline/auth'
// IMPORTANT: pino is imported as a TYPE ONLY at module scope. The runtime
// import is deferred to `initBylineCore` via `await import('pino')` so
// that this module stays bundleable on the client side. Static imports
// of pino's runtime entry resolve to `pino/browser.js` (a stub without a
// named `pino` export), which crashes Vite's module graph the moment any
// client file transitively imports `@byline/core`.
import type { Logger as PinoLogger } from 'pino'

import { registerCollectionAbilities } from './auth/register-collection-abilities.js'
import { defineBylineCore, defineServerConfig, getBylineCoreUnsafe } from './config/config.js'
import { type BylineLogger, createBylineLogger, defineLogger } from './lib/logger.js'
import { Registry } from './lib/registry.js'
import { type CollectionRecord, ensureCollections } from './services/collection-bootstrap.js'
import { discoverCounterGroups } from './services/discover-counter-groups.js'
import { validateTranslations } from './services/i18n-validator.js'
import { validateRichTextFieldFlags } from './services/richtext-populate.js'
import type {
  CollectionDefinition,
  IDbAdapter,
  IStorageProvider,
  ServerConfig,
} from './@types/index.js'

export interface BylineCore<TAdminStore = unknown> {
  config: ServerConfig<TAdminStore>
  collections: CollectionDefinition[]
  db: IDbAdapter
  storage: IStorageProvider | undefined
  logger: BylineLogger
  /**
   * Registered collections, keyed by `path`, with their current DB row id,
   * schema version, and fingerprint. Populated by `ensureCollections()` at
   * startup. Prefer `getCollectionRecord(path)` for lookups.
   */
  collectionRecords: Map<string, CollectionRecord>
  /**
   * Throwing lookup for a collection's registration record. Use this
   * wherever you need `(collectionId, collectionVersion)` — callers that
   * hit this accessor do not need a DB round-trip.
   */
  getCollectionRecord: (path: string) => CollectionRecord
  /**
   * Ability registry. Populated at init time with the CRUD + workflow
   * abilities contributed by each declared collection
   * (`collections.<path>.{read,create,update,delete,publish,changeStatus}`).
   *
   * Plugins and future subsystems contribute their own abilities via
   * `registerAbility()` — or directly against `core.abilities` — typically
   * during server bootstrap and before any admin UI renders.
   *
   * Consumed at runtime by `AdminAuth.assertAbility()` and at design
   * time by the admin role-editor UI. See docs/AUTHN-AUTHZ.md.
   */
  abilities: AbilityRegistry
  /** Convenience wrapper around `abilities.register()`. */
  registerAbility: (descriptor: AbilityDescriptor) => void
  /** Convenience wrapper around `abilities.list()`. */
  listAbilities: () => AbilityDescriptor[]
  /** Convenience wrapper around `abilities.byGroup()`. */
  getAbilitiesByGroup: () => Map<string, AbilityDescriptor[]>
  /**
   * Configured session provider. Phase 3 leaves this optional — the admin
   * server-fn middleware wired in Phase 5 will tighten the contract where
   * authentication is required.
   */
  sessionProvider: SessionProvider | undefined
  /**
   * Adapter-built admin store bundle (users / roles / permissions /
   * refresh tokens). Passed through from `ServerConfig.adminStore` so
   * consumers (server fns, seeds, admin commands) have a single
   * adapter-agnostic handle instead of reconstructing the store or
   * casting `db` to the concrete adapter type.
   *
   * Undefined when the installation does not configure admin.
   */
  adminStore: TAdminStore | undefined
}

/**
 * Initialize Byline CMS core services via the typed registry.
 *
 * This is the recommended server-side entry point. It composes the
 * dependency graph and populates the global config singleton for
 * backward compatibility with `getServerConfig()`.
 *
 * @param config - Server configuration (collections, db, storage, i18n).
 * @param pinoLogger - Optional raw Pino instance. When omitted a default
 *   `pino({ level: 'info' })` is constructed via dynamic import so the
 *   pino runtime stays out of the client bundle (see import comment above).
 */
export const initBylineCore = async <TAdminStore = unknown>(
  config: ServerConfig<TAdminStore>,
  pinoLogger?: PinoLogger
): Promise<BylineCore<TAdminStore>> => {
  if (!pinoLogger) {
    const { pino } = await import('pino')
    pinoLogger = pino({ level: 'info' })
  }
  const registry = new Registry()
    .addValue('config', config)
    .addValue('collections', config.collections)
    .addValue('db', config.db)
    .addValue('storage', config.storage)
    .addFactory('logger', createBylineLogger)

  const composed = registry.compose({ pinoLogger })

  // Validate richText field flags against the registered server adapter
  // before any DB work. Fail-fast surfaces unrenderable configurations
  // (both flags off) and missing-adapter cases at boot rather than at
  // request time.
  validateRichTextFieldFlags(composed.collections, {
    populate: config.fields?.richText?.populate != null,
    embed: config.fields?.richText?.embed != null,
  })

  // Validate the admin i18n translation registry against the configured
  // interface locale set. Throws on structural errors (missing bundle for
  // a declared locale, defaultLocale outside the permitted set, …); soft
  // warnings (key-set drift between locales) are logged so contributors
  // see translation gaps without it blocking boot. The bundle lives at
  // `i18n.translations` (one axis, not nested under `interface`) — the
  // validator takes the assembled shape so locale config and bundle
  // travel together.
  const i18nValidation = validateTranslations({
    defaultLocale: config.i18n.interface.defaultLocale,
    locales: config.i18n.interface.locales,
    translations: config.i18n.translations,
  })
  for (const warning of i18nValidation.warnings) {
    composed.logger.warn(
      {
        locale: warning.locale,
        namespace: warning.namespace,
        missingKeys: warning.missingKeys,
      },
      `[i18n] '${warning.locale}.${warning.namespace}' is missing ${warning.missingKeys.length} key(s) relative to the other locales`
    )
  }

  // Backward compat: populate globalThis singletons
  defineServerConfig(config)
  defineLogger(composed.logger)

  // Reconcile collection definitions with the database: insert new rows,
  // bump schema versions when the fingerprint has drifted, and build the
  // in-memory record cache used by the lifecycle/upload/client paths.
  const collectionRecords = await ensureCollections({
    definitions: composed.collections,
    db: composed.db,
    logger: composed.logger,
  })

  // Discover every distinct counter `group` across the registered
  // collections and ensure each one has a backing sequence in the
  // database. Runs after ensureCollections (collection-shape errors
  // surface first) and throws on any structural ban (counter inside
  // array/blocks) or adapter failure — both are fatal config issues
  // that should fail boot rather than show up at request time.
  await discoverCounterGroups({
    definitions: composed.collections,
    db: composed.db,
    logger: composed.logger,
  })

  const getCollectionRecord = (path: string): CollectionRecord => {
    const record = collectionRecords.get(path)
    if (!record) {
      throw new Error(
        `BylineCore.getCollectionRecord: no record for collection '${path}'. ` +
          `Known paths: ${Array.from(collectionRecords.keys()).join(', ') || '(none)'}`
      )
    }
    return record
  }

  // Ability registry — populated with each collection's CRUD + workflow
  // abilities. Plugins and subsystems add their own via
  // `core.registerAbility()` or `core.abilities.register()`.
  const abilities = new AbilityRegistry()
  for (const definition of composed.collections) {
    registerCollectionAbilities(abilities, definition)
  }

  const core: BylineCore<TAdminStore> = {
    config: composed.config,
    collections: composed.collections,
    db: composed.db,
    storage: composed.storage,
    logger: composed.logger,
    collectionRecords,
    getCollectionRecord,
    abilities,
    registerAbility: (descriptor) => abilities.register(descriptor),
    listAbilities: () => abilities.list(),
    getAbilitiesByGroup: () => abilities.byGroup(),
    sessionProvider: composed.config.sessionProvider,
    adminStore: composed.config.adminStore,
  }

  // Register on the global singleton so server-side packages
  // (`@byline/host-tanstack-start/server-fns/*`, future hosts) can read
  // post-init state via `getBylineCore()` instead of importing the
  // host's server config module directly.
  defineBylineCore(core)

  return core
}

/**
 * Typed accessor for the composed `BylineCore` registered by
 * `initBylineCore`. Throws if init has not run yet.
 *
 * The generic `TAdminStore` parameter mirrors `BylineCore<TAdminStore>` —
 * callers that consume `core.adminStore` should pass the concrete admin
 * store type (e.g. `getBylineCore<AdminStore>()`); callers that don't
 * touch `adminStore` can omit it.
 */
export function getBylineCore<TAdminStore = unknown>(): BylineCore<TAdminStore> {
  return getBylineCoreUnsafe() as BylineCore<TAdminStore>
}
