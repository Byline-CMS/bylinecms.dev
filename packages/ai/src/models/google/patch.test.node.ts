/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { getAiServerConfig as getServerConfig } from '../../config/ai-config'
import {
  patchDoc as patchDocNative,
  patchDocStreaming as patchDocStreamingNative,
} from './patch-native'
import {
  patchDocStreaming as patchDocStreamingVercel,
  patchDoc as patchDocVercel,
} from './patch-vercel'

const MODEL = 'gemini-2.5-flash'

describe('google patch', () => {
  beforeEach(async () => {})

  const runReal = process.env.AI_RUN_REAL_TESTS === 'true'

  if (runReal) {
    /***
     * Generates a document from Google using structured outputs.
     */
    it.skip('makes a real Google request (manual run) from native provider', async () => {
      const config = getServerConfig()
      if (!config.ai.google.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for real Google tests.')
      }

      const result = await patchDocNative({
        apiKey: config.ai.google.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      console.log(result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    /***
     * Generates a document from Google using structured outputs via streaming.
     */
    it.skip('streams a real Google response (manual run) from native provider', async () => {
      const config = getServerConfig()
      if (!config.ai.google.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for real Google tests.')
      }

      const streamResult = patchDocStreamingNative({
        apiKey: config.ai.google.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (Google Native):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (Google Native):', final)
      expect(streamedText.length).toBeGreaterThanOrEqual(0)
      expect(final).toBeTruthy()
      expect(typeof final).toBe('object')
    }, 30000)

    /***
     * Generates a document from Google using structured outputs.
     */
    it.skip('makes a real Google request (manual run) from vercel provider', async () => {
      const config = getServerConfig()
      if (!config.ai.google.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for real Google tests.')
      }

      const result = await patchDocVercel({
        apiKey: config.ai.google.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      console.log(result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    /***
     * Generates a document from Google using structured outputs via streaming.
     */
    it.skip('streams a real Google response (manual run) from vercel provider', async () => {
      const config = getServerConfig()
      if (!config.ai.google.apiKey) {
        throw new Error('GOOGLE_API_KEY is required for real Google tests.')
      }

      const streamResult = patchDocStreamingVercel({
        apiKey: config.ai.google.apiKey,
        model: MODEL,
        prompt: 'Translate into French.',
        textNodes: [{ id: 0, text: 'The sun is shining' }],
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (Google Vercel):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (Google Vercel):', final)

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
