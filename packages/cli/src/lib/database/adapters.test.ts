import { describe, expect, it } from 'vitest'

import { dependencySpecsFor } from '../../manifest/deps.js'
import { envSpecsForDialect } from '../../manifest/env.js'
import { DATABASE_ADAPTER_IDS, DATABASE_ADAPTERS } from './adapters.js'

describe.each(DATABASE_ADAPTER_IDS)('%s database adapter registration', (id) => {
  const adapter = DATABASE_ADAPTERS[id]

  it('connects the adapter to its dependency and environment manifests', () => {
    const dependencies = dependencySpecsFor({ dbDialect: id, examples: true })
    const environment = envSpecsForDialect(id)

    expect(dependencies.map((spec) => spec.name)).toContain(adapter.packageName)
    expect(dependencies.map((spec) => spec.name)).toContain(adapter.searchPackageName)
    expect(environment.map((spec) => spec.key)).toContain(adapter.connectionEnvKey)
  })

  it('declares a coherent URL contract', () => {
    expect(adapter.acceptedProtocols).toContain(`${adapter.preferredProtocol}:`)
    expect(adapter.defaultPort).toBeGreaterThan(0)
  })
})

it('keeps cross-adapter package and environment registrations unique', () => {
  const adapters = DATABASE_ADAPTER_IDS.map((id) => DATABASE_ADAPTERS[id])

  expect(new Set(adapters.map((adapter) => adapter.packageName)).size).toBe(adapters.length)
  expect(new Set(adapters.map((adapter) => adapter.searchPackageName)).size).toBe(adapters.length)
  expect(new Set(adapters.map((adapter) => adapter.connectionEnvKey)).size).toBe(adapters.length)
})
