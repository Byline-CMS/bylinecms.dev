/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { generateText, Output, streamText } from 'ai'

import { buildPatchSystemPrompt } from '@/prompts'
import {
  type LexicalTextEditsResponse,
  lexicalTextEditsResponseSchema,
} from '@/utils/lexical-text-edits'
import { anthropic } from './anthropic'

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

export async function patchDoc(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): Promise<LexicalTextEditsResponse> {
  const result = await generateText({
    model: anthropic(options.apiKey)(options.model),
    system: buildPatchSystemPrompt(),
    prompt: buildPatchUserPrompt(options.prompt, options.textNodes),
    abortSignal: options.signal,
    output: Output.object({
      schema: lexicalTextEditsResponseSchema,
    }),
  })

  return result.output as LexicalTextEditsResponse
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
  const result = streamText({
    model: anthropic(options.apiKey)(options.model),
    system: buildPatchSystemPrompt(),
    prompt: buildPatchUserPrompt(options.prompt, options.textNodes),
    abortSignal: options.signal,
    output: Output.object({
      schema: lexicalTextEditsResponseSchema,
    }),
  })

  return {
    text: result.textStream,
    final: result.output as Promise<LexicalTextEditsResponse>,
  }
}
