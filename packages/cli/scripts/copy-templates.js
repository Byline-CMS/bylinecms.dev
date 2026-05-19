#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../src/templates')
const dst = resolve(here, '../dist/templates')

if (!existsSync(src)) {
  console.error(`templates source not found: ${src}`)
  process.exit(1)
}
// Wipe dst first so files removed from src/templates (e.g. an old migration
// replaced by a fresh regen) don't linger in the published tarball.
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log(`copied templates → ${dst}`)
