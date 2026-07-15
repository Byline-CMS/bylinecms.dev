import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writeCollectionTypes } from './generate-types.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function outputPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'byline-types-'))
  temporaryDirectories.push(directory)
  return join(directory, 'generated', 'collection-types.ts')
}

describe('writeCollectionTypes', () => {
  it('writes a fresh artifact and leaves matching output untouched', () => {
    const path = outputPath()

    expect(writeCollectionTypes(path, 'generated\n', false)).toBe('written')
    expect(readFileSync(path, 'utf8')).toBe('generated\n')
    expect(writeCollectionTypes(path, 'generated\n', false)).toBe('unchanged')
  })

  it('checks current output without writing', () => {
    const path = outputPath()
    writeCollectionTypes(path, 'generated\n', false)

    expect(writeCollectionTypes(path, 'generated\n', true)).toBe('current')
  })

  it('fails check mode clearly for stale or missing output', () => {
    const path = outputPath()

    expect(() => writeCollectionTypes(path, 'generated\n', true)).toThrow(
      'generated collection types are missing'
    )
    writeCollectionTypes(path, 'old\n', false)
    expect(() => writeCollectionTypes(path, 'generated\n', true)).toThrow(
      'generated collection types are stale'
    )
    expect(readFileSync(path, 'utf8')).toBe('old\n')

    writeFileSync(path, 'still old\n', 'utf8')
    expect(() => writeCollectionTypes(path, 'generated\n', true)).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('still old\n')
  })
})
