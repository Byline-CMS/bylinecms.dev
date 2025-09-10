import type { ClientConfig, CollectionDefinition, ServerConfig } from '@/@types/index.js'

let serverConfigInstance: ServerConfig | null = null
let clientConfigInstance: ClientConfig | null = null

export const getCollectionDefinition = (path: string): CollectionDefinition | null => {
  const config = clientConfigInstance ?? serverConfigInstance
  if (config == null) {
    throw new Error(
      'Byline has not been configured yet. Please call defineClientConfig or defineServerConfig in byline.client.config.ts or byline.server.config.ts first.'
    )
  }

  return config.collections.find((collection) => collection.path === path) ?? null
}

export function defineClientConfig(config: ClientConfig) {
  clientConfigInstance = config
}

export function defineServerConfig(config: ServerConfig) {
  serverConfigInstance = config
}

export function getClientConfig(): ClientConfig {
  if (clientConfigInstance == null) {
    throw new Error(
      'Byline has not been configured yet. Please call defineClientConfig in byline.config.ts first.'
    )
  }
  return clientConfigInstance
}

export function getServerConfig(): ServerConfig {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    throw new Error('getServerConfig cannot be called on the client.')
  }
  if (serverConfigInstance == null) {
    throw new Error(
      'Byline has not been configured yet. Please call defineServerConfig in byline.config.ts first.'
    )
  }
  return serverConfigInstance
}
