import { describe, expect, it } from 'vitest'

import { dependencySpecsFor } from '../../manifest/deps.js'
import { envSpecsForAdapter } from '../../manifest/env.js'
import {
  DATABASE_ADAPTER_IDS,
  DATABASE_ADAPTERS,
  type DatabaseAdapterDefinition,
  DEFAULT_DATABASE_ADAPTER,
} from './adapters.js'

describe.each(DATABASE_ADAPTER_IDS)('%s database adapter registration', (id) => {
  const adapter: DatabaseAdapterDefinition = DATABASE_ADAPTERS[id]

  it('connects the adapter to its dependency and environment manifests', () => {
    const dependencies = dependencySpecsFor({ dbAdapter: id, examples: true })
    const environment = envSpecsForAdapter(id)

    expect(dependencies.map((spec) => spec.name)).toContain(adapter.packageName)
    if (adapter.searchPackageName) {
      expect(dependencies.map((spec) => spec.name)).toContain(adapter.searchPackageName)
    }
    expect(environment.map((spec) => spec.key)).toContain(adapter.connectionEnvKey)
  })

  it('declares a coherent URL contract', () => {
    expect(adapter.url.acceptedProtocols.length).toBeGreaterThan(0)
    expect(adapter.url.defaultPort).toBeGreaterThan(0)
  })
})

it('keeps the default explicit and first without relying on registry key order', () => {
  expect(DEFAULT_DATABASE_ADAPTER).toBe('postgres')
  expect(DATABASE_ADAPTER_IDS[0]).toBe(DEFAULT_DATABASE_ADAPTER)
  expect(DATABASE_ADAPTERS.mysql.selectionLabel).toContain('8.0.14')
})

it('keeps cross-adapter package and environment registrations unique', () => {
  const adapters: DatabaseAdapterDefinition[] = DATABASE_ADAPTER_IDS.map(
    (id) => DATABASE_ADAPTERS[id]
  )

  expect(new Set(adapters.map((adapter) => adapter.packageName)).size).toBe(adapters.length)
  const searchPackages = adapters.flatMap((adapter) =>
    adapter.searchPackageName ? [adapter.searchPackageName] : []
  )
  expect(new Set(searchPackages).size).toBe(searchPackages.length)
  expect(new Set(adapters.map((adapter) => adapter.connectionEnvKey)).size).toBe(adapters.length)
})
