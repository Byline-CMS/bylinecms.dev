/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateText as generateTextAi, jsonSchema, Output, streamText as streamTextAi } from 'ai'

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
  const openai = createOpenAI({ apiKey: options.apiKey })

  const result = await generateTextAi({
    model: openai(options.model),
    system: buildGenerateHtmlSystemPrompt(),
    prompt: buildGenerateHtmlUserPrompt(options.prompt),
    abortSignal: options.signal,
  })

  return result.text
}

export function generateHtmlStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateHtmlStreamingResult {
  const openai = createOpenAI({ apiKey: options.apiKey })

  const result = streamTextAi({
    model: openai(options.model),
    system: buildGenerateHtmlSystemPrompt(),
    prompt: buildGenerateHtmlUserPrompt(options.prompt),
    abortSignal: options.signal,
  })

  return {
    text: result.textStream,
    final: (result as any).text as Promise<string>,
  }
}

export async function generateText(options: {
  apiKey: string
  model: string
  prompt: string
  maxLength?: number
  signal?: AbortSignal
}): Promise<string> {
  const openai = createOpenAI({ apiKey: options.apiKey })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const result = await generateTextAi({
    model: openai(options.model),
    system: buildGenerateTextSystemPrompt(),
    prompt: buildGenerateTextUserPrompt(promptWithLength),
    abortSignal: options.signal,
  })

  const normalized = result.text.trim()
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
  const openai = createOpenAI({ apiKey: options.apiKey })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const result = streamTextAi({
    model: openai(options.model),
    system: buildGenerateTextSystemPrompt(),
    prompt: buildGenerateTextUserPrompt(promptWithLength),
    abortSignal: options.signal,
  })

  const text = (async function* () {
    let remaining = typeof maxLength === 'number' && maxLength > 0 ? maxLength : undefined
    for await (const delta of result.textStream) {
      if (typeof remaining === 'number') {
        if (remaining <= 0) {
          continue
        }
        const chunk = delta.slice(0, remaining)
        remaining -= chunk.length
        if (chunk.length > 0) {
          yield chunk
        }
        continue
      }

      yield delta
    }
  })()

  const final = ((result as any).text as Promise<string>).then((t) => {
    const normalized = (t ?? '').trim()
    if (typeof maxLength === 'number' && maxLength > 0) {
      return normalized.length > maxLength ? normalized.slice(0, maxLength).trimEnd() : normalized
    }
    return normalized
  })

  return { text, final }
}

export async function generateDoc(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<GeneratedDoc> {
  const openai = createOpenAI({ apiKey: options.apiKey })

  const schema = jsonSchema<GeneratedDoc>({
    ...((openaiGenerationSchema as any).schema ?? openaiGenerationSchema),
    $schema: undefined,
  })

  const result = await generateTextAi({
    model: openai(options.model),
    system: buildGenerateSystemPrompt(),
    prompt: options.prompt,
    abortSignal: options.signal,
    output: Output.object({
      schema,
    }),
  })

  return result.output as GeneratedDoc
}

export function generateDocStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateDocStreamingResult {
  const openai = createOpenAI({ apiKey: options.apiKey })

  const schema = jsonSchema<GeneratedDoc>({
    ...((openaiGenerationSchema as any).schema ?? openaiGenerationSchema),
    $schema: undefined,
  })

  const result = streamTextAi({
    model: openai(options.model),
    system: buildGenerateSystemPrompt(),
    prompt: options.prompt,
    abortSignal: options.signal,
    output: Output.object({
      schema,
    }),
  })

  return {
    text: result.textStream,
    final: result.output as Promise<GeneratedDoc>,
  }
}
