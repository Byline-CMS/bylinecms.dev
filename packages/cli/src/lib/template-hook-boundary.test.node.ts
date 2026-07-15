import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const templates = resolve(dirname(fileURLToPath(import.meta.url)), '../templates')

function source(path: string): string {
  return readFileSync(resolve(templates, path), 'utf8')
}

describe('scaffold server hook boundary', () => {
  it('keeps the example schema host-agnostic and registers its hooks from the server graph', () => {
    const schema = source('byline-examples/collections/docs/schema.ts')
    const registry = source('byline-examples/collections/server-hooks.ts')
    const serverConfig = source('byline-examples/server.config.ts')

    expect(schema).not.toContain('@tanstack/react-start')
    expect(schema).not.toContain('createServerOnlyFn')
    expect(schema).not.toContain("'./hooks.js'")
    expect(registry).toContain("docs: () => import('./docs/hooks.js')")
    expect(serverConfig).toContain("import { serverHooks } from './collections/server-hooks.js'")
    expect(serverConfig).toContain('hooks: serverHooks')
  })

  it('ships the registry seam in both scaffold flavors and configures the host build guard', () => {
    for (const flavor of ['byline', 'byline-examples']) {
      expect(source(`${flavor}/collections/server-hooks.ts`)).toContain(
        'satisfies ServerHooksConfig'
      )
      expect(source(`${flavor}/server.config.ts`)).toContain('hooks: serverHooks')
    }
    expect(source('host/vite.config.ts')).toContain(
      "import { bylineClientHookBoundary } from '@byline/host-tanstack-start/vite'"
    )
    expect(source('host/vite.config.ts')).toContain('bylineClientHookBoundary()')
  })
})
