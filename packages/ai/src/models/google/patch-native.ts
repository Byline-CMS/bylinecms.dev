/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { GoogleGenAI } from '@google/genai'

import { buildPatchSystemPrompt } from '@/prompts'
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

const tryParseJson = (text: string): unknown => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed

  return JSON.parse(candidate)
}

const normalizeJsonSchemaForGemini = (schema: unknown): unknown => {
  if (schema == null) return schema
  if (Array.isArray(schema)) return schema.map(normalizeJsonSchemaForGemini)
  if (typeof schema !== 'object') return schema

  const obj = schema as Record<string, any>
  const next: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'const') {
      next.enum = [value]
      continue
    }

    if (key === 'type' && Array.isArray(value)) {
      next.anyOf = value.map((t) => ({ type: t }))
      continue
    }

    next[key] = normalizeJsonSchemaForGemini(value)
  }

  return next
}

const normalizePatchResponse = (value: unknown): LexicalTextEditsResponse => {
  const maybeObj = value as any

  // Allow the model to return the edits array directly.
  const editsCandidate = Array.isArray(maybeObj)
    ? maybeObj
    : Array.isArray(maybeObj?.edits)
      ? maybeObj.edits
      : Array.isArray(maybeObj?.output)
        ? maybeObj.output
        : undefined

  if (!Array.isArray(editsCandidate)) {
    throw new Error('Google patch response is missing an edits array.')
  }

  const edits = editsCandidate
    .map((e: any) => {
      const idRaw = e?.id
      const textRaw = e?.text

      const id = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : NaN
      const text = typeof textRaw === 'string' ? textRaw : textRaw == null ? '' : String(textRaw)

      if (!Number.isFinite(id)) return undefined
      return { id, text }
    })
    .filter(Boolean) as Array<{ id: number; text: string }>

  return { edits }
}

const googlePatchSchema = {
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
} as const

export async function patchDoc(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): Promise<LexicalTextEditsResponse> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  const normalizedResponseJsonSchema = normalizeJsonSchemaForGemini(googlePatchSchema)

  const response = await ai.models.generateContent({
    model: options.model,
    contents: buildPatchUserPrompt(options.prompt, options.textNodes),
    config: {
      systemInstruction: buildPatchSystemPrompt(),
      responseMimeType: 'application/json',
      responseJsonSchema: normalizedResponseJsonSchema,
      abortSignal: options.signal,
    },
  })

  const text = response.text?.trim() ?? ''
  if (text.length === 0) {
    throw new Error('Google model returned an empty response.')
  }

  const parsed = tryParseJson(text)
  if (parsed && typeof parsed === 'object') {
    return normalizePatchResponse(parsed)
  }

  throw new Error('Google structured output did not return a JSON object.')
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
  const ai = new GoogleGenAI({ apiKey: options.apiKey })

  const normalizedResponseJsonSchema = normalizeJsonSchemaForGemini(googlePatchSchema)

  const streamPromise = ai.models.generateContentStream({
    model: options.model,
    contents: buildPatchUserPrompt(options.prompt, options.textNodes),
    config: {
      systemInstruction: buildPatchSystemPrompt(),
      responseMimeType: 'application/json',
      responseJsonSchema: normalizedResponseJsonSchema,
      abortSignal: options.signal,
    },
  })

  let resolveFinal!: (value: LexicalTextEditsResponse) => void
  let rejectFinal!: (reason?: unknown) => void
  const final = new Promise<LexicalTextEditsResponse>((resolve, reject) => {
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
        resolveFinal(normalizePatchResponse(parsed))
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
