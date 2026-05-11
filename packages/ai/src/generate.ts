/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { withLogContext } from '@byline/core/logger'
import Ajv from 'ajv'

import { getLogger } from './lib/logger'
import {
  generateDoc as generateAnthropicDoc,
  generateDocStreaming as generateAnthropicDocStreaming,
  generateHtml as generateAnthropicHtml,
  generateHtmlStreaming as generateAnthropicHtmlStreaming,
  generateText as generateAnthropicText,
  generateTextStreaming as generateAnthropicTextStreaming,
} from './models/anthropic/generate'
import {
  generateDoc as generateGeminiDoc,
  generateDocStreaming as generateGeminiDocStreaming,
  generateHtml as generateGeminiHtml,
  generateHtmlStreaming as generateGeminiHtmlStreaming,
  generateText as generateGeminiText,
  generateTextStreaming as generateGeminiTextStreaming,
} from './models/google/generate'
import {
  generateDoc as generateOpenAIDoc,
  generateDocStreaming as generateOpenAIDocStreaming,
  generateHtml as generateOpenAIHtml,
  generateHtmlStreaming as generateOpenAIHtmlStreaming,
  generateText as generateOpenAIText,
  generateTextStreaming as generateOpenAITextStreaming,
} from './models/openai/generate'
import { documentSchema } from './schemas/lexical-json-schema'
import { convertToLexical } from './utils/convert-to-lexical'
import type { Provider } from './@types'

const ajv = new Ajv({ allErrors: true, strict: false })
const validateLexicalDocument = ajv.compile(documentSchema as any)

export interface GenerateOptions {
  provider: Provider
  apiKey: string
  modelName: string
  prompt: string
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

const pickGenerateHtml = (provider: Provider) =>
  provider === 'openai'
    ? generateOpenAIHtml
    : provider === 'google'
      ? generateGeminiHtml
      : generateAnthropicHtml

const pickGenerateHtmlStreaming = (provider: Provider) =>
  provider === 'openai'
    ? generateOpenAIHtmlStreaming
    : provider === 'google'
      ? generateGeminiHtmlStreaming
      : generateAnthropicHtmlStreaming

const pickGenerateDoc = (provider: Provider) =>
  provider === 'openai'
    ? generateOpenAIDoc
    : provider === 'google'
      ? generateGeminiDoc
      : generateAnthropicDoc

const pickGenerateDocStreaming = (provider: Provider) =>
  provider === 'openai'
    ? generateOpenAIDocStreaming
    : provider === 'google'
      ? generateGeminiDocStreaming
      : generateAnthropicDocStreaming

const pickGenerateText = (provider: Provider) =>
  provider === 'openai'
    ? generateOpenAIText
    : provider === 'google'
      ? generateGeminiText
      : generateAnthropicText

const pickGenerateTextStreaming = (provider: Provider) =>
  provider === 'openai'
    ? generateOpenAITextStreaming
    : provider === 'google'
      ? generateGeminiTextStreaming
      : generateAnthropicTextStreaming

async function processGenerationResult(
  generated: any,
  options: GenerateOptions
): Promise<GenerateResult | GenerateError> {
  return withLogContext(
    { domain: 'ai', module: 'generate', function: 'processGenerationResult' },
    () => processGenerationResultImpl(generated, options)
  )
}

async function processGenerationResultImpl(
  generated: any,
  options: GenerateOptions
): Promise<GenerateResult | GenerateError> {
  const { provider, apiKey, modelName, prompt, signal } = options
  const logger = getLogger()

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
  const generateHtml = pickGenerateHtml(provider)

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
    logger.error({ err: error }, 'HTML fallback generation failed')
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
  const { provider, apiKey, modelName, prompt, signal, inputText } = options

  const generateDoc = pickGenerateDoc(provider)

  const composedPrompt = composeTextPrompt(prompt, inputText)
  const generated = await generateDoc({ apiKey, model: modelName, prompt: composedPrompt, signal })

  return processGenerationResult(generated, options)
}

/**
 * Streams a Lexical document generation.
 */
export function generateStructuredStreaming(options: GenerateOptions): GenerateStreamingResult {
  const { provider, apiKey, modelName, prompt, signal, inputText } = options

  const generateDocStreaming = pickGenerateDocStreaming(provider)

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
  const { provider, apiKey, modelName, prompt, signal, inputText } = options

  const generateHtml = pickGenerateHtml(provider)

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
  const { provider, apiKey, modelName, prompt, signal, inputText } = options

  const generateHtmlStreaming = pickGenerateHtmlStreaming(provider)

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
  const { provider, apiKey, modelName, prompt, signal, maxLength, inputText } = options

  const generateText = pickGenerateText(provider)

  const composedPrompt = composeTextPrompt(prompt, inputText)

  const text = await generateText({
    apiKey,
    model: modelName,
    prompt: composedPrompt,
    maxLength,
    signal,
  })
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
  const { provider, apiKey, modelName, prompt, signal, maxLength, inputText } = options

  const generateTextStreaming = pickGenerateTextStreaming(provider)

  const composedPrompt = composeTextPrompt(prompt, inputText)

  const streamResult = generateTextStreaming({
    apiKey,
    model: modelName,
    prompt: composedPrompt,
    maxLength,
    signal,
  })

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
