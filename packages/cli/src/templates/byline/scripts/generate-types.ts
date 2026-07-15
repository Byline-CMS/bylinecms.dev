import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { emitCollectionTypes } from '@byline/core/codegen'

import { collections } from '../collections/index.js'

const defaultOutputPath = fileURLToPath(
  new URL('../generated/collection-types.ts', import.meta.url)
)

export type GenerationStatus = 'current' | 'unchanged' | 'written'

export function writeCollectionTypes(
  outputPath: string,
  source: string,
  check: boolean
): GenerationStatus {
  const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : undefined

  if (check) {
    if (existing === undefined) {
      throw new Error(
        `generated collection types are missing: ${outputPath}. Run pnpm byline:generate`
      )
    }
    if (existing !== source) {
      throw new Error(
        `generated collection types are stale: ${outputPath}. Run pnpm byline:generate`
      )
    }
    return 'current'
  }

  if (existing === source) return 'unchanged'

  mkdirSync(dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, source, 'utf8')
    renameSync(temporaryPath, outputPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
  return 'written'
}

function parseArgs(args: readonly string[]): { check: boolean } {
  const unknown = args.filter((arg) => arg !== '--check')
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown.join(', ')}`)
  if (args.filter((arg) => arg === '--check').length > 1) {
    throw new Error('duplicate argument: --check')
  }
  return { check: args.includes('--check') }
}

export function generateCollectionTypes(
  outputPath = defaultOutputPath,
  check = false
): { hash: string; status: GenerationStatus } {
  const { source, hash } = emitCollectionTypes(collections)
  return { hash, status: writeCollectionTypes(outputPath, source, check) }
}

function main(): void {
  const { check } = parseArgs(process.argv.slice(2))
  const { hash, status } = generateCollectionTypes(defaultOutputPath, check)
  console.log(`collection types: ${collections.length} collections ${hash.slice(0, 12)} ${status}`)
}

const entryPath = process.argv[1]
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(`collection type generation failed: ${(error as Error).message}`)
    process.exitCode = 1
  }
}
