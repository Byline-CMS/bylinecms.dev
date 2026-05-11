/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import OpenAI from 'openai'

import {
  buildGenerateHtmlSystemPrompt,
  buildGenerateHtmlUserPrompt,
  buildGenerateSystemPrompt,
  buildGenerateTextSystemPrompt,
  buildGenerateTextUserPrompt,
} from '@/prompts'
import { openaiGenerationSchema } from './schema'
import type { GeneratedDoc } from '@/utils/convert-to-lexical'

export type GenerateDocStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<GeneratedDoc>
}

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
  const client = new OpenAI({ apiKey: options.apiKey })

  const result = await client.responses.create(
    {
      model: options.model,
      input: [
        { role: 'system', content: buildGenerateHtmlSystemPrompt() },
        { role: 'user', content: buildGenerateHtmlUserPrompt(options.prompt) },
      ],
      text: {
        format: { type: 'text' },
      },
    } as any,
    options.signal ? { signal: options.signal } : undefined
  )

  const refusal = (result as any)?.output?.[0]?.content?.find(
    (c: any) => c?.type === 'refusal'
  )?.refusal
  if (typeof refusal === 'string' && refusal.length > 0) {
    throw new Error(refusal)
  }

  const outputText = getOutputText(result)
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    return outputText.trim()
  }

  throw new Error('OpenAI did not return any HTML output.')
}

export function generateHtmlStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateHtmlStreamingResult {
  const client = new OpenAI({ apiKey: options.apiKey })

  const stream = client.responses.stream(
    {
      model: options.model,
      input: [
        { role: 'system', content: buildGenerateHtmlSystemPrompt() },
        { role: 'user', content: buildGenerateHtmlUserPrompt(options.prompt) },
      ],
      text: {
        format: { type: 'text' },
      },
      stream: true,
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const text = (async function* () {
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield event.delta
      }
    }
  })()

  const final = (async () => {
    const result = await stream.finalResponse()

    const refusal = (result as any)?.output?.[0]?.content?.find(
      (c: any) => c?.type === 'refusal'
    )?.refusal
    if (typeof refusal === 'string' && refusal.length > 0) {
      throw new Error(refusal)
    }

    const outputText = getOutputText(result)
    if (typeof outputText === 'string' && outputText.trim().length > 0) {
      return outputText.trim()
    }

    throw new Error('OpenAI did not return any HTML output.')
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
  const client = new OpenAI({ apiKey: options.apiKey })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const result = await client.responses.create(
    {
      model: options.model,
      input: [
        { role: 'system', content: buildGenerateTextSystemPrompt() },
        { role: 'user', content: buildGenerateTextUserPrompt(promptWithLength) },
      ],
      text: {
        format: { type: 'text' },
      },
    } as any,
    options.signal ? { signal: options.signal } : undefined
  )

  const refusal = (result as any)?.output?.[0]?.content?.find(
    (c: any) => c?.type === 'refusal'
  )?.refusal
  if (typeof refusal === 'string' && refusal.length > 0) {
    throw new Error(refusal)
  }

  const outputText = getOutputText(result)
  if (typeof outputText !== 'string' || outputText.trim().length === 0) {
    throw new Error('OpenAI did not return any plain text output.')
  }

  const normalized = outputText.trim()
  if (typeof maxLength === 'number' && maxLength > 0) {
    return normalized.length > maxLength ? normalized.slice(0, maxLength).trimEnd() : normalized
  }

  return normalized
}

export function generateTextStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  maxLength?: number
  signal?: AbortSignal
}): GenerateTextStreamingResult {
  const client = new OpenAI({ apiKey: options.apiKey })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const stream = client.responses.stream(
    {
      model: options.model,
      input: [
        { role: 'system', content: buildGenerateTextSystemPrompt() },
        { role: 'user', content: buildGenerateTextUserPrompt(promptWithLength) },
      ],
      text: {
        format: { type: 'text' },
      },
      stream: true,
    } as any,
    options.signal ? { signal: options.signal } : undefined
  )

  const text = (async function* () {
    let remaining = typeof maxLength === 'number' && maxLength > 0 ? maxLength : undefined

    for await (const event of stream) {
      if (event.type !== 'response.output_text.delta') {
        continue
      }

      if (typeof remaining === 'number') {
        if (remaining <= 0) {
          continue
        }
        const chunk = event.delta.slice(0, remaining)
        remaining -= chunk.length
        if (chunk.length > 0) {
          yield chunk
        }
        continue
      }

      yield event.delta
    }
  })()

  const final = (async () => {
    const result = await stream.finalResponse()

    const refusal = (result as any)?.output?.[0]?.content?.find(
      (c: any) => c?.type === 'refusal'
    )?.refusal
    if (typeof refusal === 'string' && refusal.length > 0) {
      throw new Error(refusal)
    }

    const outputText = getOutputText(result)
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      throw new Error('OpenAI did not return any plain text output.')
    }

    const normalized = outputText.trim()
    if (typeof maxLength === 'number' && maxLength > 0) {
      return normalized.length > maxLength ? normalized.slice(0, maxLength).trimEnd() : normalized
    }

    return normalized
  })()

  return { text, final }
}

const getOutputText = (result: any) => {
  if (typeof result?.output_text === 'string') {
    return result.output_text
  }

  if (Array.isArray(result?.output)) {
    const texts: string[] = []
    for (const output of result.output) {
      if (output?.type !== 'message' || !Array.isArray(output?.content)) {
        continue
      }
      for (const content of output.content) {
        if (content?.type === 'output_text' && typeof content?.text === 'string') {
          texts.push(content.text)
        }
      }
    }
    if (texts.length > 0) {
      return texts.join('')
    }
  }

  return undefined
}

const parseGeneratedDoc = (result: any) => {
  const parsed = (result as any).output_parsed as GeneratedDoc | undefined
  if (parsed && typeof parsed === 'object') {
    return parsed
  }

  const outputText = getOutputText(result)
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    try {
      const json = JSON.parse(outputText)
      if (json && typeof json === 'object') {
        return json as GeneratedDoc
      }
    } catch {
      // fall through to error below
    }
  }

  throw new Error('OpenAI structured output did not return a parsed object.')
}

/***
 * Generates a document from OpenAI using structured outputs.
 */
export async function generateDoc(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<GeneratedDoc> {
  const client = new OpenAI({ apiKey: options.apiKey })

  // OpenAI Structured Outputs expects `text.format` to be a json_schema format.
  // Our `openaiGenerationSchema` matches the OpenAI shape (name/strict/schema),
  // but we add the required discriminator here.
  const format = {
    type: 'json_schema',
    ...openaiGenerationSchema,
  } as any

  const result = await client.responses.parse(
    {
      model: options.model,
      input: [
        {
          role: 'system',
          content: buildGenerateSystemPrompt(),
        },
        {
          role: 'user',
          content: options.prompt,
        },
      ],
      text: {
        format,
      },
    },
    options.signal ? { signal: options.signal } : undefined
  )

  // console.log(result.usage)

  // If the model refused, the parsed output will be missing.
  const refusal = (result as any)?.output?.[0]?.content?.find(
    (c: any) => c?.type === 'refusal'
  )?.refusal
  if (typeof refusal === 'string' && refusal.length > 0) {
    throw new Error(refusal)
  }

  return parseGeneratedDoc(result)
}

/***
 * Streams a document generation from OpenAI using structured outputs.
 */
export function generateDocStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateDocStreamingResult {
  const client = new OpenAI({ apiKey: options.apiKey })

  const format = {
    type: 'json_schema',
    ...openaiGenerationSchema,
  } as any

  const stream = client.responses.stream(
    {
      model: options.model,
      input: [
        {
          role: 'system',
          content: buildGenerateSystemPrompt(),
        },
        {
          role: 'user',
          content: options.prompt,
        },
      ],
      text: {
        format,
      },
      stream: true,
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const text = (async function* () {
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield event.delta
      }
    }
  })()

  const final = (async () => {
    const result = await stream.finalResponse()

    const refusal = (result as any)?.output?.[0]?.content?.find(
      (c: any) => c?.type === 'refusal'
    )?.refusal
    if (typeof refusal === 'string' && refusal.length > 0) {
      throw new Error(refusal)
    }

    return parseGeneratedDoc(result)
  })()

  return { text, final }
}
