/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { getAiServerConfig as getServerConfig } from '../../config/ai-config'
import { patchDoc, patchDocStreaming } from './patch'

const MODEL = 'claude-sonnet-4-5-20250929'

describe('anthropic patch', () => {
  beforeEach(async () => {})

  const runReal = process.env.AI_RUN_REAL_TESTS === 'true'

  if (runReal) {
    it.skip('makes a real Anthropic request (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for real Anthropic tests.')
      }

      const result = await patchDoc({
        apiKey: config.ai.anthropic.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      console.log(result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    it.skip('streams a real Anthropic response (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for real Anthropic tests.')
      }

      const streamResult = patchDocStreaming({
        apiKey: config.ai.anthropic.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (Anthropic):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (Anthropic):', final)
      expect(streamedText.length).toBeGreaterThanOrEqual(0)
      expect(final).toBeTruthy()
      expect(typeof final).toBe('object')
    }, 30000)
  } else {
    it.skip('skips real Anthropic tests', () => {
      console.log('Set AI_RUN_REAL_TESTS=true to run real Anthropic tests.')
    })
  }
})
