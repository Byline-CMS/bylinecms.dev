import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { CollectionDefinition } from '@byline/core'
import { emitCollectionTypes } from '@byline/core/codegen'
import { describe, expect, it } from 'vitest'

const templates = resolve(dirname(fileURLToPath(import.meta.url)), 'templates')

describe('example generated collection types', () => {
  it('matches the codegen emitter for the committed collection and singleton definitions', async () => {
    const registryUrl = pathToFileURL(
      resolve(templates, 'byline-examples/collections/index.ts')
    ).href
    const { collections } = (await import(registryUrl)) as {
      collections: readonly CollectionDefinition[]
    }
    const generatedPath = resolve(templates, 'byline-examples/generated/collection-types.ts')
    const emitted = emitCollectionTypes(collections).source
    if (process.env.UPDATE_TEMPLATE_GENERATED_TYPES === '1') {
      writeFileSync(generatedPath, emitted, 'utf8')
    }

    expect(readFileSync(generatedPath, 'utf8')).toBe(emitted)
  })
})
