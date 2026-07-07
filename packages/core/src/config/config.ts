import { validateAdminConfigs } from './validate-admin-configs.js'
import { validateCollections } from './validate-collections.js'
import type {
  ClientConfig,
  CollectionAdminConfig,
  CollectionDefinition,
  ColumnDefinition,
  ServerConfig,
} from '@/@types/index.js'

// ---------------------------------------------------------------------------
// Global config storage
// ---------------------------------------------------------------------------
// Store config instances on `globalThis` so that every copy of this module
// (which can happen in Vite SSR when workspace-linked packages are resolved
// through different module graphs) shares the same state.
// ---------------------------------------------------------------------------

const BYLINE_SERVER_CONFIG = Symbol.for('__byline_server_config__')
const BYLINE_CLIENT_CONFIG = Symbol.for('__byline_client_config__')
const BYLINE_CORE = Symbol.for('__byline_core__')

function getServerConfigInstance(): ServerConfig | null {
  return (globalThis as any)[BYLINE_SERVER_CONFIG] ?? null
}
function setServerConfigInstance(config: ServerConfig) {
  ;(globalThis as any)[BYLINE_SERVER_CONFIG] = config
}

function getClientConfigInstance(): ClientConfig | null {
  return (globalThis as any)[BYLINE_CLIENT_CONFIG] ?? null
}
function setClientConfigInstance(config: ClientConfig) {
  ;(globalThis as any)[BYLINE_CLIENT_CONFIG] = config
}

function getBylineCoreInstance(): unknown | null {
  return (globalThis as any)[BYLINE_CORE] ?? null
}
function setBylineCoreInstance(core: unknown) {
  ;(globalThis as any)[BYLINE_CORE] = core
}

/**
 * Resolve a collection definition by `path`. Returns `null` either when
 * no config has been registered (e.g. unit tests, isolated tooling) or
 * when a config is registered but doesn't carry a collection at that
 * path. Matches the `T | null` return contract so callers can branch
 * without try/catch.
 *
 * If a caller genuinely *requires* a registered config to proceed, it
 * should reach for `getClientConfig()` / `getServerConfig()` — those
 * still throw the loud "Byline has not been configured" error.
 */
export const getCollectionDefinition = (path: string): CollectionDefinition | null => {
  const config = getClientConfigInstance() ?? getServerConfigInstance()
  if (config == null) return null

  return config.collections.find((collection) => collection.path === path) ?? null
}

export const getCollectionAdminConfig = (slug: string): CollectionAdminConfig | null => {
  const clientConfig = getClientConfigInstance()
  if (clientConfig == null) return null
  return clientConfig.admin?.find((admin) => admin.slug === slug) ?? null
}

/**
 * Resolve a collection's item-row/tile columns — the per-collection projection
 * + presentation contract used by the relation picker, relation/`hasMany`
 * tiles, and (planned) search-result rows.
 *
 * Prefers the canonical {@link CollectionAdminConfig.itemView}, falling back to
 * the deprecated `picker` alias. Always read item-view columns through this
 * helper rather than touching `config.picker` directly, so the alias keeps
 * working until it is removed.
 */
export const resolveItemViewColumns = (
  config: CollectionAdminConfig | null | undefined
): ColumnDefinition[] | undefined => config?.itemView ?? config?.picker

export function defineClientConfig(config: ClientConfig) {
  validateCollections(config.collections)
  validateAdminConfigs(config.admin, config.collections)
  setClientConfigInstance(config)
}

export function defineServerConfig(config: ServerConfig) {
  validateCollections(config.collections)
  setServerConfigInstance(config)
}

export function getClientConfig(): ClientConfig {
  const clientConfig = getClientConfigInstance()
  if (clientConfig != null) {
    return clientConfig
  }
  // During SSR the client entry has not run yet, but the server config
  // carries the same collection definitions.  Return a compatible object
  // so route loaders and components work in both contexts.
  const serverConfig = getServerConfigInstance()
  if (serverConfig != null) {
    return {
      serverURL: serverConfig.serverURL,
      i18n: serverConfig.i18n,
      routes: serverConfig.routes,
      collections: serverConfig.collections,
      admin: [],
    } as ClientConfig
  }
  throw new Error(
    'Byline has not been configured yet. Please call defineClientConfig in byline.config.ts first.'
  )
}

export function getServerConfig(): ServerConfig {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    throw new Error('getServerConfig cannot be called on the client.')
  }
  const serverConfig = getServerConfigInstance()
  if (serverConfig == null) {
    throw new Error(
      'Byline has not been configured yet. Please call defineServerConfig in byline.config.ts first.'
    )
  }
  return serverConfig
}

/**
 * Order a set of locale codes by their position in the configured content
 * locale list. The order source is `i18n.content.locales` — the authoritative,
 * always-complete configured set — **not** `i18n.content.localeDefinitions`,
 * which is an optional labels overlay a host may provide for only *some*
 * codes (ordering off it would drop unlabelled content locales to the end).
 *
 * Codes absent from that order fall to the end, ordered alphabetically among
 * themselves, so the result is always deterministic and never throws. This is
 * deliberately origin-agnostic: a code that isn't a configured content
 * locale — an interface-only locale, a stale/removed code, a typo — is
 * preserved and sorted last rather than dropped or thrown. The function only
 * sorts; it never filters, so set membership is never changed. The same holds
 * when no server config is registered (the order is empty → plain a–z sort).
 *
 * `availableLocales` (and `_availableVersionLocales`) are *sets* — their
 * array order carries no meaning — so this makes that order stable and
 * config-driven at the read source. The payoff is canonical downstream
 * ordering (display switcher, hreflang `alternates`, sitemap) regardless of
 * the order a document declared its locales in. Read-time projection only;
 * nothing persisted changes. See docs/07-internationalization/index.md.
 */
export function orderByContentLocale(codes: string[]): string[] {
  const content = getServerConfigInstance()?.i18n?.content
  const order = content?.locales ?? content?.localeDefinitions?.map((l) => l.code) ?? []
  const index = new Map(order.map((code, i) => [code, i] as const))
  return [...codes].sort((a, b) => {
    const ia = index.get(a) ?? Number.POSITIVE_INFINITY
    const ib = index.get(b) ?? Number.POSITIVE_INFINITY
    if (ia !== ib) return ia - ib
    // Stable, deterministic tiebreak for codes that share a rank — i.e.
    // multiple unknown codes (both +Infinity), or the no-config fallback
    // where every code is unknown and this degrades to a plain a–z sort.
    return a < b ? -1 : a > b ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// BylineCore singleton — the composed runtime returned by `initBylineCore`.
// Server-side packages that need post-init state (the abilities registry,
// the resolved admin store) read it here rather than importing the host's
// host server config module directly. Stored as `unknown` to avoid a
// circular type dependency between `config.ts` and `core.ts`; consumers
// import the typed `getBylineCore<TAdminStore>()` re-export from
// `core.ts`.
// ---------------------------------------------------------------------------

export function defineBylineCore(core: unknown): void {
  setBylineCoreInstance(core)
}

export function getBylineCoreUnsafe(): unknown {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    throw new Error('getBylineCore cannot be called on the client.')
  }
  const core = getBylineCoreInstance()
  if (core == null) {
    throw new Error(
      'BylineCore has not been initialised yet. Please call initBylineCore() in your server config first.'
    )
  }
  return core
}
