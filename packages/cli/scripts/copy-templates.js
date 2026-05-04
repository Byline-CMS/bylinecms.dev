#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../src/templates')
const dst = resolve(here, '../dist/templates')

if (!existsSync(src)) {
  console.error(`templates source not found: ${src}`)
  process.exit(1)
}
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log(`copied templates → ${dst}`)
