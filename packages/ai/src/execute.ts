/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { withLogContext } from '@byline/core/logger'
import { z } from 'zod'

import { instructionSchema } from './@types'
import { getAiServerConfig } from './config/ai-config'
import {
  generateHtml,
  generateHtmlStreaming,
  generateStructured,
  generateStructuredStreaming,
  generateText,
  generateTextStreaming,
} from './generate'
import { getLogger } from './lib/logger'
import { patch, patchStreaming } from './patch'
import type {
  ExecuteInstructionOptions,
  ExecuteInstructionParams,
  InstructionMode,
  InstructionState,
  OutputPreference,
  Provider,
} from './@types'
import type { GenerateStreamingResult } from './generate'
import type { PatchStreamingResult } from './patch'

type ValidatedInstruction = {
  mode: InstructionMode
  apiKey: string
  input: { type: 'structured' | 'text'; value: any | null }
  modelName: string
  prompt: string
  provider: Provider
  output: OutputPreference
}

const isAbortLikeError = (error: unknown): boolean => {
  if (error == null) return false

  // Many libraries throw DOM-style AbortError
  const anyErr = error as any
  if (anyErr?.name === 'AbortError') return true

  // OpenAI Node SDK (responses/streaming + undici) can throw these.
  if (anyErr?.type === 'APIUserAbortError') return true

  // Undici abort error (often surfaces as name ResponseAborted)
  if (anyErr?.name === 'ResponseAborted') return true

  // Some libs only set message text.
  const message = typeof anyErr?.message === 'string' ? anyErr.message : ''
  if (message.toLowerCase().includes('aborted')) return true

  return false
}

const createEmptyTextStream = (): AsyncIterable<string> =>
  (async function* () {
    // intentionally empty
  })()

const validateInstructionFields = (
  params: ExecuteInstructionParams
): { ok: true; data: ValidatedInstruction } | { ok: false; errorState: InstructionState } => {
  const config = getAiServerConfig()
  const validatedFields = instructionSchema.safeParse(params)

  if (validatedFields.success === false) {
    return {
      ok: false,
      errorState: {
        errors: z.flattenError(validatedFields.error).fieldErrors,
        message: 'Missing fields in instruction form.',
        status: 'failed',
      },
    }
  }

  const { prompt, input, provider, model: modelName, mode } = validatedFields.data
  const output = validatedFields.data.output ?? ({ type: 'structured' } as const)

  // Validate that the appropriate API key exists for the selected provider
  let apiKey: string | undefined
  switch (provider) {
    case 'openai':
      apiKey = config.ai.openai.apiKey
      break
    case 'google':
      apiKey = config.ai.google.apiKey
      break
    case 'anthropic':
      apiKey = config.ai.anthropic.apiKey
      break
  }

  if (apiKey == null || apiKey.length === 0) {
    return {
      ok: false,
      errorState: {
        errors: { prompt: [], editor: [] },
        message: `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key is missing on the server.`,
        status: 'failed',
      },
    }
  }

  let inputValue: any | null = null
  if (input.type === 'structured') {
    try {
      inputValue = JSON.parse(input.editorJson)
    } catch {
      return {
        ok: false,
        errorState: {
          errors: { editor: ['Editor state must be valid JSON.'] },
          message: 'Editor state is invalid JSON.',
          status: 'failed',
        },
      }
    }
  }

  if (output.type === 'structured' && input.type !== 'structured') {
    return {
      ok: false,
      errorState: {
        errors: { editor: ['Structured output requires structured editor input.'] },
        message: 'Structured output requires structured editor input.',
        status: 'failed',
      },
    }
  }

  if (input.type === 'text') {
    inputValue = input.text
  }

  return {
    ok: true,
    data: {
      mode,
      apiKey,
      input: {
        type: input.type,
        value: inputValue,
      },
      modelName,
      prompt,
      provider,
      output,
    },
  }
}

export async function executeInstruction(
  params: ExecuteInstructionParams,
  options?: ExecuteInstructionOptions
): Promise<InstructionState> {
  return withLogContext({ domain: 'ai', module: 'execute', function: 'executeInstruction' }, () =>
    executeInstructionImpl(params, options)
  )
}

async function executeInstructionImpl(
  params: ExecuteInstructionParams,
  options?: ExecuteInstructionOptions
): Promise<InstructionState> {
  const startedAt = Date.now()

  const withLastRun = (state: InstructionState): InstructionState => {
    return { ...state, lastRun: Date.now() - startedAt }
  }

  const logger = getLogger()
  const validated = validateInstructionFields(params)

  if (validated.ok === false) {
    return withLastRun(validated.errorState)
  }

  const { prompt, input, provider, modelName, apiKey, output, mode } = validated.data

  // Resolve existing content as plain text for use as context in new_with_context / patch modes.
  const contextText =
    mode !== 'new'
      ? input.type === 'structured'
        ? JSON.stringify(input.value)
        : String(input.value ?? '')
      : undefined

  try {
    if (output.type === 'html') {
      const result = await generateHtml({
        provider,
        apiKey,
        modelName,
        prompt,
        inputText: contextText,
        signal: options?.signal,
      })

      if (result.success) {
        return withLastRun({
          errors: {},
          message: result.message,
          format: 'html',
          html: result.html,
          status: 'success',
        })
      }

      return withLastRun({
        errors: result.errors,
        message: result.message,
        status: 'failed',
      })
    }

    if (output.type === 'text') {
      const result = await generateText({
        provider,
        apiKey,
        modelName,
        prompt,
        inputText: contextText,
        maxLength: output.maxLength,
        signal: options?.signal,
      })

      if (result.success) {
        return withLastRun({
          errors: {},
          message: result.message,
          format: 'text',
          text: result.text,
          status: 'success',
        })
      }

      return withLastRun({
        errors: result.errors,
        message: result.message,
        status: 'failed',
      })
    }

    // output.type === 'structured'
    if (input.type !== 'structured' || input.value == null) {
      return withLastRun({
        errors: { editor: ['Structured output requires structured editor input.'] },
        message: 'Structured output requires structured editor input.',
        status: 'failed',
      })
    }

    if (mode === 'patch') {
      const result = await patch({
        provider,
        apiKey,
        modelName,
        prompt,
        editorState: input.value,
        signal: options?.signal,
      })

      if (result.success) {
        return withLastRun({
          errors: {},
          message: result.message,
          editor: result.editor,
          format: 'lexical',
          status: 'success',
        })
      }

      return withLastRun({
        errors: result.errors,
        message: result.message,
        status: 'failed',
      })
    }

    // mode === 'new' or mode === 'new_with_context'
    const result = await generateStructured({
      provider,
      apiKey,
      modelName,
      prompt,
      inputText: contextText,
      signal: options?.signal,
    })

    if (result.success) {
      switch (result.format) {
        case 'html':
          return withLastRun({
            errors: {},
            message: result.message,
            format: 'html',
            html: result.html,
            status: 'success',
          })
        case 'text':
          return withLastRun({
            errors: {},
            message: result.message,
            format: 'text',
            text: result.text,
            status: 'success',
          })
        case 'lexical':
          return withLastRun({
            errors: {},
            message: result.message,
            format: 'lexical',
            editor: result.editor,
            status: 'success',
          })
      }
    }

    return withLastRun({
      errors: result.errors,
      message: result.message,
      status: 'failed',
    })
  } catch (error) {
    // Cancellation is expected behavior; do not log at error level.
    if (isAbortLikeError(error)) {
      return withLastRun({
        errors: {},
        message: 'Cancelled.',
        status: 'idle',
      })
    }

    logger.error({ err: error }, 'error calling instruction action')

    return withLastRun({
      errors: {},
      message: 'Failed to complete AI instruction.',
      status: 'failed',
    })
  }
}

export type ExecuteInstructionStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<InstructionState>
}

export function executeInstructionStreaming(
  params: ExecuteInstructionParams,
  options?: ExecuteInstructionOptions
): ExecuteInstructionStreamingResult {
  return withLogContext(
    { domain: 'ai', module: 'execute', function: 'executeInstructionStreaming' },
    () => executeInstructionStreamingImpl(params, options)
  )
}

function executeInstructionStreamingImpl(
  params: ExecuteInstructionParams,
  options?: ExecuteInstructionOptions
): ExecuteInstructionStreamingResult {
  const startedAt = Date.now()
  const withLastRun = (state: InstructionState): InstructionState => {
    return { ...state, lastRun: Date.now() - startedAt }
  }

  const logger = getLogger()
  const validated = validateInstructionFields(params)

  if (validated.ok === false) {
    return {
      text: createEmptyTextStream(),
      final: Promise.resolve(withLastRun(validated.errorState)),
    }
  }

  const { prompt, input, provider, modelName, apiKey, output, mode } = validated.data

  // Resolve existing content as plain text for use as context in new_with_context / patch modes.
  const contextText =
    mode !== 'new'
      ? input.type === 'structured'
        ? JSON.stringify(input.value)
        : String(input.value ?? '')
      : undefined

  try {
    let streamResult: GenerateStreamingResult | PatchStreamingResult

    if (output.type === 'html') {
      streamResult = generateHtmlStreaming({
        provider,
        apiKey,
        modelName,
        prompt,
        inputText: contextText,
        signal: options?.signal,
      })
    } else if (output.type === 'text') {
      streamResult = generateTextStreaming({
        provider,
        apiKey,
        modelName,
        prompt,
        inputText: contextText,
        maxLength: output.maxLength,
        signal: options?.signal,
      })
    } else {
      if (input.type !== 'structured' || input.value == null) {
        return {
          text: createEmptyTextStream(),
          final: Promise.resolve(
            withLastRun({
              errors: { editor: ['Structured output requires structured editor input.'] },
              message: 'Structured output requires structured editor input.',
              status: 'failed',
            })
          ),
        }
      }

      if (mode === 'patch') {
        streamResult = patchStreaming({
          provider,
          apiKey,
          modelName,
          prompt,
          editorState: input.value,
          signal: options?.signal,
        })
      } else {
        // mode === 'new' or mode === 'new_with_context'
        streamResult = generateStructuredStreaming({
          provider,
          apiKey,
          modelName,
          prompt,
          inputText: contextText,
          signal: options?.signal,
        })
      }
    }

    const final = (async (): Promise<InstructionState> => {
      try {
        const result = await streamResult.final

        if (result.success) {
          if ('format' in result) {
            switch (result.format) {
              case 'html':
                return withLastRun({
                  errors: {},
                  message: result.message,
                  format: 'html',
                  html: result.html,
                  status: 'success',
                })
              case 'text':
                return withLastRun({
                  errors: {},
                  message: result.message,
                  format: 'text',
                  text: result.text,
                  status: 'success',
                })
              case 'lexical':
                return withLastRun({
                  errors: {},
                  message: result.message,
                  format: 'lexical',
                  editor: result.editor,
                  status: 'success',
                })
            }
          }

          // Patch success (structured patch) returns an editor.
          return withLastRun({
            errors: {},
            message: result.message,
            format: 'lexical',
            editor: result.editor,
            status: 'success',
          })
        }

        return withLastRun({
          errors: result.errors,
          message: result.message,
          status: 'failed',
        })
      } catch (error) {
        if (isAbortLikeError(error)) {
          return withLastRun({
            errors: {},
            message: 'Cancelled.',
            status: 'idle',
          })
        }

        logger.error({ err: error }, 'error calling instruction action')

        return withLastRun({
          errors: {},
          message: 'Failed to complete AI instruction.',
          status: 'failed',
        })
      }
    })()

    return { text: streamResult.text, final }
  } catch (error) {
    if (isAbortLikeError(error)) {
      return {
        text: createEmptyTextStream(),
        final: Promise.resolve(
          withLastRun({
            errors: {},
            message: 'Cancelled.',
            status: 'idle',
          })
        ),
      }
    }

    logger.error({ err: error }, 'error calling instruction action')

    return {
      text: createEmptyTextStream(),
      final: Promise.resolve(
        withLastRun({
          errors: {},
          message: 'Failed to complete AI instruction.',
          status: 'failed',
        })
      ),
    }
  }
}
