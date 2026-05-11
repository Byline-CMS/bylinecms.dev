/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { getAiServerConfig as getServerConfig } from '../../config/ai-config'
import { generateDoc, generateDocStreaming } from './generate'

const MODEL = 'gpt-5.2'

describe('openai generate', () => {
  beforeEach(async () => {})

  const runReal = process.env.AI_RUN_REAL_TESTS === 'true'

  if (runReal) {
    it.skip('makes a real OpenAI request (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.openai.apiKey) {
        throw new Error('OPENAI_API_KEY is required for real OpenAI tests.')
      }

      const result = await generateDoc({
        apiKey: config.ai.openai.apiKey,
        model: MODEL,
        prompt: 'Create a haiku poem about a child by the sea.',
      })

      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    it.skip('streams a real OpenAI response (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.openai.apiKey) {
        throw new Error('OPENAI_API_KEY is required for real OpenAI tests.')
      }

      const streamResult = generateDocStreaming({
        apiKey: config.ai.openai.apiKey,
        model: MODEL,
        prompt: 'Create a haiku poem about a child by the sea.',
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
