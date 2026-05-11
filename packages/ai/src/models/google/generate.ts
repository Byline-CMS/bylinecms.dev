/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { GoogleGenAI } from '@google/genai'

import {
  buildGenerateHtmlSystemPrompt,
  buildGenerateHtmlUserPrompt,
  buildGenerateSystemPrompt,
  buildGenerateTextSystemPrompt,
  buildGenerateTextUserPrompt,
} from '@/prompts'
import { normalizeGeneratedDoc } from './normalize-generated-doc'
import { geminiGenerationSchema2 } from './schema'
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
  const google = new GoogleGenAI({ apiKey: options.apiKey })

  const response = await google.models.generateContent({
    model: options.model,
    config: { systemInstruction: buildGenerateHtmlSystemPrompt() },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildGenerateHtmlUserPrompt(options.prompt) }],
      },
    ],
  })

  return response.text?.trim() ?? ''
}

export function generateHtmlStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): GenerateHtmlStreamingResult {
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  const streamPromise = ai.models.generateContentStream({
    model: options.model,
    config: {
      systemInstruction: buildGenerateHtmlSystemPrompt(),
      abortSignal: options.signal,
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildGenerateHtmlUserPrompt(options.prompt) }],
      },
    ],
  })

  let resolveFinal!: (value: string) => void
  let rejectFinal!: (reason?: unknown) => void
  const final = new Promise<string>((resolve, reject) => {
    resolveFinal = resolve
    rejectFinal = reject
  })

  const text = (async function* () {
    let buffered = ''
    try {
      const stream = await streamPromise
      for await (const chunk of stream) {
        const chunkText =
          typeof (chunk as any)?.text === 'function' ? (chunk as any).text() : (chunk as any)?.text
        if (typeof chunkText === 'string' && chunkText.length > 0) {
          buffered += chunkText
          yield chunkText
        }
      }

      resolveFinal(buffered.trim())
    } catch (error) {
      rejectFinal(error)
      throw error
    }
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
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const response = await ai.models.generateContent({
    model: options.model,
    config: {
      systemInstruction: buildGenerateTextSystemPrompt(),
      abortSignal: options.signal,
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildGenerateTextUserPrompt(promptWithLength) }],
      },
    ],
  })

  const normalized = response.text?.trim() ?? ''
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
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  const maxLength =
    typeof options.maxLength === 'number' && Number.isFinite(options.maxLength)
      ? Math.floor(options.maxLength)
      : undefined

  const promptWithLength =
    typeof maxLength === 'number' && maxLength > 0
      ? `${options.prompt}\n\nConstraints:\n- Maximum length: ${maxLength} characters.`
      : options.prompt

  const streamPromise = ai.models.generateContentStream({
    model: options.model,
    config: {
      systemInstruction: buildGenerateTextSystemPrompt(),
      abortSignal: options.signal,
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildGenerateTextUserPrompt(promptWithLength) }],
      },
    ],
  })

  let resolveFinal!: (value: string) => void
  let rejectFinal!: (reason?: unknown) => void
  const final = new Promise<string>((resolve, reject) => {
    resolveFinal = resolve
    rejectFinal = reject
  })

  const text = (async function* () {
    let buffered = ''
    let remaining = typeof maxLength === 'number' && maxLength > 0 ? maxLength : undefined

    try {
      const stream = await streamPromise
      for await (const chunk of stream) {
        const chunkText =
          typeof (chunk as any)?.text === 'function' ? (chunk as any).text() : (chunk as any)?.text
        if (typeof chunkText !== 'string' || chunkText.length === 0) {
          continue
        }

        buffered += chunkText

        if (typeof remaining === 'number') {
          if (remaining <= 0) {
            continue
          }
          const sliced = chunkText.slice(0, remaining)
          remaining -= sliced.length
          if (sliced.length > 0) {
            yield sliced
          }
          continue
        }

        yield chunkText
      }

      const normalized = buffered.trim()
      if (typeof maxLength === 'number' && maxLength > 0) {
        resolveFinal(
          normalized.length > maxLength ? normalized.slice(0, maxLength).trimEnd() : normalized
        )
      } else {
        resolveFinal(normalized)
      }
    } catch (error) {
      rejectFinal(error)
      throw error
    }
  })()

  return { text, final }
}

const tryParseJson = (text: string): unknown => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  // Defensive: sometimes models wrap JSON in code fences.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed

  return JSON.parse(candidate)
}

export async function generateDoc(options: {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
}): Promise<GeneratedDoc> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  const response = await ai.models.generateContent({
    model: options.model,
    contents: options.prompt,
    config: {
      systemInstruction: buildGenerateSystemPrompt(),
      responseMimeType: 'application/json',
      responseJsonSchema: geminiGenerationSchema2,
      abortSignal: options.signal,
    },
  })

  const text = response.text?.trim() ?? ''
  if (text.length === 0) {
    throw new Error('Google model returned an empty response.')
  }

  const parsed = tryParseJson(text)
  if (parsed && typeof parsed === 'object') {
    return normalizeGeneratedDoc(parsed)
  }

  throw new Error('Google structured output did not return a JSON object.')
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
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  // const responseJsonSchema = {
  //   ...(geminiGenerationSchema as any),
  //   $schema: undefined,
  // }

  // const normalizedResponseJsonSchema = normalizeJsonSchemaForGemini(responseJsonSchema)

  const streamPromise = ai.models.generateContentStream({
    model: options.model,
    contents: options.prompt,
    config: {
      systemInstruction: buildGenerateSystemPrompt(),
      responseMimeType: 'application/json',
      // responseJsonSchema: normalizedResponseJsonSchema,
      responseJsonSchema: geminiGenerationSchema2,
      abortSignal: options.signal,
    },
  })

  let resolveFinal!: (value: GeneratedDoc) => void
  let rejectFinal!: (reason?: unknown) => void
  const final = new Promise<GeneratedDoc>((resolve, reject) => {
    resolveFinal = resolve
    rejectFinal = reject
  })

  const text = (async function* () {
    let buffered = ''
    try {
      const stream = await streamPromise
      for await (const chunk of stream) {
        const chunkText =
          typeof (chunk as any)?.text === 'function' ? (chunk as any).text() : (chunk as any)?.text
        if (typeof chunkText === 'string' && chunkText.length > 0) {
          buffered += chunkText
          yield chunkText
        }
      }

      const trimmed = buffered.trim()
      if (trimmed.length === 0) {
        throw new Error('Google model returned an empty response.')
      }

      const parsed = tryParseJson(trimmed)
      if (parsed && typeof parsed === 'object') {
        resolveFinal(normalizeGeneratedDoc(parsed))
        return
      }

      throw new Error('Google structured output did not return a JSON object.')
    } catch (error) {
      rejectFinal(error)
      throw error
    }
  })()

  return { text, final }
}
