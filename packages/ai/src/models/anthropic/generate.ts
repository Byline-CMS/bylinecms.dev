/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import Anthropic from '@anthropic-ai/sdk'

import {
  buildGenerateHtmlSystemPrompt,
  buildGenerateHtmlUserPrompt,
  buildGenerateSystemPrompt,
  buildGenerateTextSystemPrompt,
  buildGenerateTextUserPrompt,
} from '@/prompts'
import { anthropicGenerationSchema } from './schema'
import { jsonSchemaFormat, readStructuredOutput } from './structured-output'
import type { GeneratedDoc } from '@/utils/convert-to-lexical'

export type GenerateTextStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<string>
}

export type GenerateHtmlStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<string>
}

export async function generateHtml(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<string> {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const message = await client.messages.create(
    {
      model: options.model,
      max_tokens: 4096,
      system: buildGenerateHtmlSystemPrompt(),
      messages: [{ role: 'user', content: buildGenerateHtmlUserPrompt(options.prompt) }],
    },
    { signal: options.signal }
  )

  const textBlock = message.content.find((b) => b.type === 'text')
  return textBlock?.text ?? ''
}

export function generateHtmlStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateHtmlStreamingResult {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: 4096,
      system: buildGenerateHtmlSystemPrompt(),
      messages: [{ role: 'user', content: buildGenerateHtmlUserPrompt(options.prompt) }],
      stream: true,
    },
    options.signal ? { signal: options.signal } : undefined
  )

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
    const html = (message.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b?.text)
      .filter((t: any) => typeof t === 'string' && t.length > 0)
      .join('')

    return html.trim()
  })()

  return { text, final }
}

export async function generateText(options: {
  apiKey: string
  model: string
  prompt: string
  maxLength?: number
  signal?: AbortSignal
}): Promise<string> {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const message = await client.messages.create(
    {
      model: options.model,
      max_tokens: 4096,
      system: buildGenerateTextSystemPrompt(),
      messages: [{ role: 'user', content: buildGenerateTextUserPrompt(promptWithLength) }],
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const text = (message.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b?.text)
    .filter((t: any) => typeof t === 'string' && t.length > 0)
    .join('')
    .trim()

  if (typeof maxLength === 'number' && maxLength > 0) {
    return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text
  }

  return text
}

export function generateTextStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  maxLength?: number
  signal?: AbortSignal
}): GenerateTextStreamingResult {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: 4096,
      system: buildGenerateTextSystemPrompt(),
      messages: [{ role: 'user', content: buildGenerateTextUserPrompt(promptWithLength) }],
      stream: true,
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const text = (async function* () {
    let remaining = typeof maxLength === 'number' && maxLength > 0 ? maxLength : undefined

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') {
        continue
      }

      const deltaText = (event as any)?.delta?.text
      if (typeof deltaText !== 'string' || deltaText.length === 0) {
        continue
      }

      if (typeof remaining === 'number') {
        if (remaining <= 0) {
          continue
        }
        const chunk = deltaText.slice(0, remaining)
        remaining -= chunk.length
        if (chunk.length > 0) {
          yield chunk
        }
        continue
      }

      yield deltaText
    }
  })()

  const final = (async () => {
    const message = await stream.finalMessage()
    const combined = (message.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b?.text)
      .filter((t: any) => typeof t === 'string' && t.length > 0)
      .join('')
      .trim()

    if (typeof maxLength === 'number' && maxLength > 0) {
      return combined.length > maxLength ? combined.slice(0, maxLength).trimEnd() : combined
    }

    return combined
  })()

  return { text, final }
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

// The official Anthropic SDK expects a base URL like https://api.anthropic.com
// (it will handle the /v1 path internally). We defensively normalize env input.
const normalizeAnthropicBaseURLForSdk = (value: string | undefined) => {
  const base = (value && value.trim().length > 0 ? value : 'https://api.anthropic.com')
    .trim()
    .replace(/\/+$/, '')

  return base.endsWith('/v1') ? base.slice(0, -3) : base
}

export async function generateDoc(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<GeneratedDoc> {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  // Anthropic-native structured outputs: the response text is constrained to
  // the GeneratedDoc (blocks) schema. max_tokens leaves room for the adaptive
  // thinking that current models run by default.
  const message = await client.messages.create(
    {
      model: options.model,
      max_tokens: 16000,
      system: buildGenerateSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: options.prompt,
        },
      ],
      output_config: { format: jsonSchemaFormat(anthropicGenerationSchema) },
    },
    options.signal ? { signal: options.signal } : undefined
  )

  return readStructuredOutput<GeneratedDoc>(message)
}

export type GenerateDocStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<GeneratedDoc>
}

export function generateDocStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateDocStreamingResult {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: 16000,
      system: buildGenerateSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: options.prompt,
        },
      ],
      output_config: { format: jsonSchemaFormat(anthropicGenerationSchema) },
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
    return readStructuredOutput<GeneratedDoc>(message)
  })()

  return { text, final }
}
