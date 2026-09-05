import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const cliTemplates = resolve(here, '../templates')
const webappByline = resolve(here, '../../../../apps/webapp/byline')

const exactCopies = [
  {
    name: 'media regeneration operation',
    template: 'byline-examples/scripts/regenerate-media-operation.ts',
    application: 'scripts/regenerate-media-operation.ts',
  },
  {
    name: 'media regeneration caller',
    template: 'byline-examples/scripts/regenerate-media.ts',
    application: 'scripts/regenerate-media.ts',
  },
  {
    name: 'PostgreSQL source-locale re-anchor script',
    template: 'dialects/postgres/byline-examples/scripts/re-anchor.ts',
    application: 'scripts/re-anchor.ts',
  },
  {
    name: 'singleton seed',
    template: 'byline-examples/seeds/site-settings.ts',
    application: 'seeds/site-settings.ts',
  },
] as const

describe('R01 copied maintenance scripts', () => {
  for (const copy of exactCopies) {
    it(`keeps the ${copy.name} byte-for-byte equal to its application copy`, () => {
      expect(readFileSync(resolve(webappByline, copy.application), 'utf8')).toBe(
        readFileSync(resolve(cliTemplates, copy.template), 'utf8')
      )
    })
  }
})
