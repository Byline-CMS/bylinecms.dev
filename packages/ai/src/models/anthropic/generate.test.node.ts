import { beforeEach, describe, expect, it } from 'vitest'

import { getAiServerConfig as getServerConfig } from '../../config/ai-config'
import {
  generateDoc as generateDocNative,
  generateDocStreaming as generateDocStreamingNative,
} from './generate-native'
import {
  generateDocStreaming as generateDocStreamingVercel,
  generateDoc as generateDocVercel,
} from './generate-vercel'

const MODEL = 'claude-sonnet-4-5-20250929'

describe('anthropic generate', () => {
  beforeEach(async () => {})

  const runReal = process.env.AI_RUN_REAL_TESTS === 'true'

  if (runReal) {
    /***
     * Generates a document from Anthropic using structured outputs.
     */
    it.skip('makes a real Anthropic request (manual run) from native provider', async () => {
      const config = getServerConfig()
      if (!config.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for real Anthropic tests.')
      }

      const result = await generateDocNative({
        apiKey: config.ai.anthropic.apiKey,
        model: MODEL,
        prompt: 'Create a haiku poem about a child by the sea.',
      })

      // console.log(result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    /***
     * Generates a document from Anthropic using structured outputs via streaming.
     */
    it.skip('streams a real Anthropic response (manual run) from native provider', async () => {
      const config = getServerConfig()
      if (!config.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for real Anthropic tests.')
      }

      const streamResult = generateDocStreamingNative({
        apiKey: config.ai.anthropic.apiKey,
        model: MODEL,
        prompt: 'Create a haiku poem about a child by the sea.',
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (Anthropic Native):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (Anthropic Native):', final)
      expect(streamedText.length).toBeGreaterThanOrEqual(0)
      expect(final).toBeTruthy()
      expect(typeof final).toBe('object')
    }, 30000)

    /***
     * Generates a document from Anthropic using structured outputs.
     */
    it.skip('makes a real Anthropic request (manual run) from vercel provider', async () => {
      const config = getServerConfig()
      if (!config.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for real Anthropic tests.')
      }

      const result = await generateDocVercel({
        apiKey: config.ai.anthropic.apiKey,
        model: MODEL,
        prompt: 'Create a haiku poem about a child by the sea.',
      })

      // console.log(result)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('object')
    }, 30000)

    /***
     * Generates a document from Anthropic using structured outputs via streaming.
     */
    it.skip('streams a real Anthropic response (manual run) from vercel provider', async () => {
      const config = getServerConfig()
      if (!config.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for real Anthropic tests.')
      }

      const streamResult = generateDocStreamingVercel({
        apiKey: config.ai.anthropic.apiKey,
        model: MODEL,
        prompt: 'Create a haiku poem about a child by the sea.',
      })

      let streamedText = ''
      for await (const chunk of streamResult.text) {
        streamedText += chunk
        console.log('STREAM CHUNK (Anthropic Vercel):', chunk)
      }

      const final = await streamResult.final
      console.log('FINAL RESULT (Anthropic Vercel):', final)
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
