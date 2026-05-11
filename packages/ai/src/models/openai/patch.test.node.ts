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

const MODEL = 'gpt-5.2'

describe('openai patch', () => {
  beforeEach(async () => {})

  const runReal = process.env.AI_RUN_REAL_TESTS === 'true'

  if (runReal) {
    it.skip('makes a real OpenAI request (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.openai.apiKey) {
        throw new Error('OPENAI_API_KEY is required for real OpenAI tests.')
      }

      const result = await patchDoc({
        apiKey: config.ai.openai.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      console.log(result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    it.skip('streams a real OpenAI response (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.openai.apiKey) {
        throw new Error('OPENAI_API_KEY is required for real OpenAI tests.')
      }

      const streamResult = patchDocStreaming({
        apiKey: config.ai.openai.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (OpenAI):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (OpenAI):', final)
      expect(streamedText.length).toBeGreaterThanOrEqual(0)
      expect(final).toBeTruthy()
      expect(typeof final).toBe('object')
    }, 30000)
  } else {
    it.skip('skips real OpenAI tests', () => {
      console.log('Set AI_RUN_REAL_TESTS=true to run real OpenAI tests.')
    })
  }
})
