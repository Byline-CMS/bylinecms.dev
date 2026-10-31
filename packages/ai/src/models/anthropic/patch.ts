/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import Anthropic from '@anthropic-ai/sdk'

import { buildPatchSystemPrompt } from '@/prompts'
import { jsonSchemaFormat, readStructuredOutput } from './structured-output'
import type { LexicalTextEditsResponse } from '@/utils/lexical-text-edits'

const buildPatchUserPrompt = (
  instruction: string,
  textNodes: Array<{ id: number; text: string }>
) => {
  return [
    `INSTRUCTION: ${instruction}`,
    '',
    'INPUT_TEXT_NODES_JSON:',
    JSON.stringify(textNodes),
  ].join('\n')
}

const isValidHttpUrl = (value: string | undefined): value is string => {
  if (value == null || value.trim().length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeAnthropicBaseURLForSdk = (value: string | undefined) => {
  const base = (value && value.trim().length > 0 ? value : 'https://api.anthropic.com')
    .trim()
    .replace(/\/+$/, '')

  return base.endsWith('/v1') ? base.slice(0, -3) : base
}

const anthropicPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['id', 'text'],
      },
    },
  },
  required: ['edits'],
}

export async function patchDoc(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): Promise<LexicalTextEditsResponse> {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  // Anthropic-native structured outputs: the response text is constrained to
  // the edits schema. max_tokens leaves room for the adaptive thinking that
  // current models run by default.
  const message = await client.messages.create(
    {
      model: options.model,
      max_tokens: 16000,
      system: buildPatchSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildPatchUserPrompt(options.prompt, options.textNodes),
        },
      ],
      output_config: { format: jsonSchemaFormat(anthropicPatchSchema) },
    },
    options.signal ? { signal: options.signal } : undefined
  )

  return readStructuredOutput<LexicalTextEditsResponse>(message)
}

export type PatchDocStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<LexicalTextEditsResponse>
}

export function patchDocStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): PatchDocStreamingResult {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: 16000,
      system: buildPatchSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildPatchUserPrompt(options.prompt, options.textNodes),
        },
      ],
      output_config: { format: jsonSchemaFormat(anthropicPatchSchema) },
      stream: true,
    },
    options.signal ? { signal: options.signal } : undefined
  )

  // Structured-output JSON arrives as text deltas; thinking deltas carry no
  // `text` and are not yielded.
  const text = (async function* () {
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const deltaText = (event as any)?.delta?.text
        if (typeof deltaText === 'string' && deltaText.length > 0) {
          yield deltaText
        }
      }
    }
  })()

  const final = (async () => {
    const message = await stream.finalMessage()
    return readStructuredOutput<LexicalTextEditsResponse>(message)
  })()

  return { text, final }
}
