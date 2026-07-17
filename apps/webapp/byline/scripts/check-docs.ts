/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { resolve } from 'node:path'

import { checkDocSources } from './lib/docs-check.js'

async function expandPatterns(patterns: string[]): Promise<string[]> {
  const files = new Set<string>()
  for (const pattern of patterns) {
    for await (const file of glob(pattern)) {
      if (file.endsWith('.md') || file.endsWith('.markdown')) files.add(resolve(file))
    }
  }
  return [...files].sort()
}

async function run(): Promise<void> {
  const patterns = process.argv.slice(2)
  if (patterns.length === 0) {
    throw new Error('check-docs: provide at least one file path or glob')
  }

  const files = await expandPatterns(patterns)
  if (files.length === 0) throw new Error('check-docs: no markdown files matched')

  const result = checkDocSources(
    files.map((filePath) => ({ filePath, source: readFileSync(filePath, 'utf8') }))
  )

  for (const issue of result.issues) {
    console.error(`${issue.filePath}:${issue.line} [${issue.kind}] ${issue.detail}`)
  }

  if (result.issues.length > 0) {
    console.error(
      `check-docs: ${result.issues.length} issue(s) across ${result.documents} parsed document(s) and ${result.links} link(s).`
    )
    process.exitCode = 1
    return
  }

  console.log(`check-docs: ${result.documents} document(s) and ${result.links} link(s) passed.`)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
