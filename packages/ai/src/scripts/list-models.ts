/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { listAllModels as listAnthropic } from '../models/anthropic/anthropic-models'
import { listAllModels as listGoogle } from '../models/google/google-models'
import { listAllModels as listOpenAI } from '../models/openai/openai-models'

type ProviderResult = {
  provider: string
  models: { id: string; name: string }[]
  error?: string
}

async function fetchProvider(
  provider: string,
  fn: () => Promise<{ id: string; name: string }[]>
): Promise<ProviderResult> {
  try {
    const models = await fn()
    return { provider, models }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { provider, models: [], error: message }
  }
}

function printResults(results: ProviderResult[]) {
  const divider = '─'.repeat(72)

  for (const { provider, models, error } of results) {
    console.log(`\n${divider}`)
    console.log(` ${provider}`)
    console.log(divider)

    if (error) {
      console.log(`  ⚠ Error: ${error}\n`)
      continue
    }

    if (models.length === 0) {
      console.log('  No models found.\n')
      continue
    }

    const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id))
    const maxIdLen = Math.min(
      48,
      sorted.reduce((max, m) => Math.max(max, m.id.length), 0)
    )

    for (const model of sorted) {
      const id = model.id.padEnd(maxIdLen)
      const name = model.name !== model.id ? `  ${model.name}` : ''
      console.log(`  ${id}${name}`)
    }
  }

  console.log()
}

async function main() {
  console.log('\nFetching models from all providers...')

  const results = await Promise.all([
    fetchProvider('OpenAI', listOpenAI),
    fetchProvider('Google', listGoogle),
    fetchProvider('Anthropic', listAnthropic),
  ])

  printResults(results)
}

main()
