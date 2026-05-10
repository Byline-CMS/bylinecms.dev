/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import Ajv from 'ajv'

import { getLogger } from './lib/logger'
import {
  getGenerateDoc as getGenerateAnthropicDoc,
  getGenerateDocStreaming as getGenerateAnthropicDocStreaming,
  getGenerateHtml as getGenerateAnthropicHtml,
  getGenerateHtmlStreaming as getGenerateAnthropicHtmlStreaming,
  getGenerateText as getGenerateAnthropicText,
  getGenerateTextStreaming as getGenerateAnthropicTextStreaming,
} from './models/anthropic/generate'
import {
  getGenerateDoc as getGenerateGeminiDoc,
  getGenerateDocStreaming as getGenerateGeminiDocStreaming,
  getGenerateHtml as getGenerateGeminiHtml,
  getGenerateHtmlStreaming as getGenerateGeminiHtmlStreaming,
  getGenerateText as getGenerateGeminiText,
  getGenerateTextStreaming as getGenerateGeminiTextStreaming,
} from './models/google/generate'
import {
  getGenerateDoc as getGenerateOpenAIDoc,
  getGenerateDocStreaming as getGenerateOpenAIDocStreaming,
  getGenerateHtml as getGenerateOpenAIHtml,
  getGenerateHtmlStreaming as getGenerateOpenAIHtmlStreaming,
  getGenerateText as getGenerateOpenAIText,
  getGenerateTextStreaming as getGenerateOpenAITextStreaming,
} from './models/openai/generate'
import { documentSchema } from './schemas/lexical-json-schema'
import { convertToLexical } from './utils/convert-to-lexical'
import type { Provider, Sdk } from './@types'

const ajv = new Ajv({ allErrors: true, strict: false })
const validateLexicalDocument = ajv.compile(documentSchema as any)
const logger = getLogger()

export interface GenerateOptions {
  provider: Provider
  apiKey: string
  modelName: string
  prompt: string
  sdk: Sdk
  inputText?: string
  signal?: AbortSignal
}

export type GenerateResult =
  | {
      success: true
      format: 'lexical'
      editor: any
      message: string
    }
  | {
      success: true
      format: 'html'
      html: string
      message: string
    }
  | {
      success: true
      format: 'text'
      text: string
      message: string
    }

export type GenerateStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<GenerateResult | GenerateError>
}

export interface GenerateError {
  success: false
  message: string
  errors: Record<string, string[]>
}

export interface GenerateTextOptions extends GenerateOptions {
  maxLength?: number
}

const composeTextPrompt = (prompt: string, inputText?: string): string => {
  const trimmedPrompt = prompt.trim()
  const trimmedInput = inputText?.trim()
  const delimiter = '\n\n---\n'
  if (trimmedInput == null) return trimmedPrompt
  return `${trimmedPrompt}${delimiter}${trimmedInput}`
}

async function processGenerationResult(
  generated: any,
  options: GenerateOptions
): Promise<GenerateResult | GenerateError> {
  const { provider, apiKey, modelName, prompt, sdk, signal } = options

  const generatedDocument = convertToLexical(generated)

  const isValid = validateLexicalDocument(generatedDocument)
  if (isValid) {
    return {
      success: true,
      format: 'lexical',
      editor: generatedDocument,
      message: 'Task completed successfully via AI instruction (generate mode).',
    }
  }

  const validationErrors = (validateLexicalDocument.errors ?? []).map((e) => {
    const instancePath = e.instancePath ? ` at ${e.instancePath}` : ''
    const message = e.message ?? 'Schema validation error'
    return `${message}${instancePath}`
  })

  logger.warn({ errors: validationErrors }, 'Lexical validation failed, attempting HTML fallback')

  // Fallback: generate HTML when the model cannot reliably produce valid Lexical JSON.
  const generateHtml =
    provider === 'openai'
      ? getGenerateOpenAIHtml(sdk)
      : provider === 'google'
        ? getGenerateGeminiHtml(sdk)
        : getGenerateAnthropicHtml(sdk)

  try {
    const html = await generateHtml({ apiKey, model: modelName, prompt, signal })
    const trimmedHtml = html?.trim() ?? ''
    if (trimmedHtml.length > 0) {
      return {
        success: true,
        format: 'html',
        html: trimmedHtml,
        message: 'Generated HTML fallback (Lexical JSON validation failed).',
      }
    }
  } catch (error) {
    logger.error(error, 'HTML fallback generation failed')
  }

  return {
    success: false,
    message: 'AI failed to generate a valid Lexical document (and HTML fallback was empty).',
    errors: {
      editor: validationErrors,
    },
  }
}

/**
 * Generates a new Lexical document from scratch based on a user prompt.
 * Uses the documentSchema to ensure the AI generates valid Lexical JSON
 * with proper structure including headings, paragraphs, lists, etc.
 */
export async function generateStructured(
  options: GenerateOptions
): Promise<GenerateResult | GenerateError> {
  const { provider, apiKey, modelName, prompt, sdk, signal, inputText } = options

  const generateDoc =
    provider === 'openai'
      ? getGenerateOpenAIDoc(sdk)
      : provider === 'google'
        ? getGenerateGeminiDoc(sdk)
        : getGenerateAnthropicDoc(sdk)

  const composedPrompt = composeTextPrompt(prompt, inputText)
  const generated = await generateDoc({ apiKey, model: modelName, prompt: composedPrompt, signal })

  return processGenerationResult(generated, options)
}

/**
 * Streams a Lexical document generation.
 */
export function generateStructuredStreaming(options: GenerateOptions): GenerateStreamingResult {
  const { provider, apiKey, modelName, prompt, sdk, signal, inputText } = options

  const generateDocStreaming =
    provider === 'openai'
      ? getGenerateOpenAIDocStreaming(sdk)
      : provider === 'google'
        ? getGenerateGeminiDocStreaming(sdk)
        : getGenerateAnthropicDocStreaming(sdk)

  const composedPrompt = composeTextPrompt(prompt, inputText)
  const streamResult = generateDocStreaming({
    apiKey,
    model: modelName,
    prompt: composedPrompt,
    signal,
  })

  const final = (async (): Promise<GenerateResult | GenerateError> => {
    const generated = await streamResult.final
    return processGenerationResult(generated, options)
  })()

  return { text: streamResult.text, final }
}

export async function generateHtml(
  options: GenerateOptions
): Promise<Extract<GenerateResult, { format: 'html' }> | GenerateError> {
  const { provider, apiKey, modelName, prompt, sdk, signal, inputText } = options

  const generateHtml =
    provider === 'openai'
      ? getGenerateOpenAIHtml(sdk)
      : provider === 'google'
        ? getGenerateGeminiHtml(sdk)
        : getGenerateAnthropicHtml(sdk)

  const composedPrompt = composeTextPrompt(prompt, inputText)
  const html = await generateHtml({ apiKey, model: modelName, prompt: composedPrompt, signal })
  const trimmed = html?.trim() ?? ''
  if (trimmed.length === 0) {
    return {
      success: false,
      message: 'AI returned empty HTML.',
      errors: { prompt: ['AI returned empty HTML.'] },
    }
  }

  return {
    success: true,
    format: 'html',
    html: trimmed,
    message: 'Generated HTML successfully.',
  }
}

export function generateHtmlStreaming(options: GenerateOptions): GenerateStreamingResult {
  const { provider, apiKey, modelName, prompt, sdk, signal, inputText } = options

  const generateHtmlStreaming =
    provider === 'openai'
      ? getGenerateOpenAIHtmlStreaming(sdk)
      : provider === 'google'
        ? getGenerateGeminiHtmlStreaming(sdk)
        : getGenerateAnthropicHtmlStreaming(sdk)

  const composedPrompt = composeTextPrompt(prompt, inputText)
  const streamResult = generateHtmlStreaming({
    apiKey,
    model: modelName,
    prompt: composedPrompt,
    signal,
  })

  const final = (async (): Promise<GenerateResult | GenerateError> => {
    const html = await streamResult.final
    const trimmed = html?.trim() ?? ''
    if (trimmed.length === 0) {
      return {
        success: false,
        message: 'AI returned empty HTML.',
        errors: { prompt: ['AI returned empty HTML.'] },
      }
    }

    return {
      success: true,
      format: 'html',
      html: trimmed,
      message: 'Generated HTML successfully.',
    }
  })()

  return { text: streamResult.text, final }
}

export async function generateText(
  options: GenerateTextOptions
): Promise<Extract<GenerateResult, { format: 'text' }> | GenerateError> {
  const { provider, apiKey, modelName, prompt, sdk, signal, maxLength, inputText } = options

  const generateText =
    provider === 'openai'
      ? getGenerateOpenAIText(sdk)
      : provider === 'google'
        ? getGenerateGeminiText(sdk)
        : getGenerateAnthropicText(sdk)

  const composedPrompt = composeTextPrompt(prompt, inputText)

  // console.log('Composed Prompt:', composedPrompt)

  const text = await generateText({
    apiKey,
    model: modelName,
    prompt: composedPrompt,
    maxLength,
    signal,
  } as any)
  const trimmed = text?.trim() ?? ''
  if (trimmed.length === 0) {
    return {
      success: false,
      message: 'AI returned empty text.',
      errors: { prompt: ['AI returned empty text.'] },
    }
  }

  return {
    success: true,
    format: 'text',
    text: trimmed,
    message: 'Generated text successfully.',
  }
}

export function generateTextStreaming(options: GenerateTextOptions): GenerateStreamingResult {
  const { provider, apiKey, modelName, prompt, sdk, signal, maxLength, inputText } = options

  const generateTextStreaming =
    provider === 'openai'
      ? getGenerateOpenAITextStreaming(sdk)
      : provider === 'google'
        ? getGenerateGeminiTextStreaming(sdk)
        : getGenerateAnthropicTextStreaming(sdk)

  const composedPrompt = composeTextPrompt(prompt, inputText)

  // console.log('Composed Prompt:', composedPrompt)

  const streamResult = generateTextStreaming({
    apiKey,
    model: modelName,
    prompt: composedPrompt,
    maxLength,
    signal,
  } as any)

  const final = (async (): Promise<GenerateResult | GenerateError> => {
    const text = await streamResult.final
    const trimmed = text?.trim() ?? ''
    if (trimmed.length === 0) {
      return {
        success: false,
        message: 'AI returned empty text.',
        errors: { prompt: ['AI returned empty text.'] },
      }
    }

    return {
      success: true,
      format: 'text',
      text: trimmed,
      message: 'Generated text successfully.',
    }
  })()

  return { text: streamResult.text, final }
}
