import { validateAdminConfigs } from './validate-admin-configs.js'
import { validateCollections } from './validate-collections.js'
import type {
  ClientConfig,
  CollectionAdminConfig,
  CollectionDefinition,
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

export const getCollectionDefinition = (path: string): CollectionDefinition | null => {
  const config = getClientConfigInstance() ?? getServerConfigInstance()
  if (config == null) {
    throw new Error(
      'Byline has not been configured yet. Please call defineClientConfig or defineServerConfig in your admin/server config first.'
    )
  }

  return config.collections.find((collection) => collection.path === path) ?? null
}

export const getCollectionAdminConfig = (slug: string): CollectionAdminConfig | null => {
  const clientConfig = getClientConfigInstance()
  if (clientConfig == null) return null
  return clientConfig.admin?.find((admin) => admin.slug === slug) ?? null
}

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
