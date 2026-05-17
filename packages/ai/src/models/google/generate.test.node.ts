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

const MODEL = 'gemini-2.5-flash'

describe('google generate', () => {
  beforeEach(async () => {})

  const runReal = process.env.AI_RUN_REAL_TESTS === 'true'

  if (runReal) {
    it('makes a real Google request (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.google.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for real Google tests.')
      }

      const result = await generateDoc({
        apiKey: config.ai.google.apiKey,
        model: MODEL,
        prompt: 'Write a short description of the solar system..',
      })

      console.log('RESULT (Google):', result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    it.skip('streams a real Google response (manual run)', async () => {
      const config = getServerConfig()
      if (!config.ai.google.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for real Google tests.')
      }

      const streamResult = generateDocStreaming({
        apiKey: config.ai.google.apiKey,
        model: MODEL,
        prompt: 'Write a short description of the solar system..',
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (Google):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (Google):', final)

      expect(streamedText.length).toBeGreaterThanOrEqual(0)
      expect(final).toBeTruthy()
      expect(typeof final).toBe('object')
    }, 30000)
  } else {
    it.skip('skips real Google tests', () => {
      console.log('Set AI_RUN_REAL_TESTS=true to run real Google tests.')
    })
  }
})
