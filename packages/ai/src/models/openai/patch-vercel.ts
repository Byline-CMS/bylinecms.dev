import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output, streamText } from 'ai'

import { buildPatchSystemPrompt } from '@/prompts'
import {
  type LexicalTextEditsResponse,
  lexicalTextEditsResponseSchema,
} from '@/utils/lexical-text-edits'

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

export type PatchDocStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<LexicalTextEditsResponse>
}

export async function patchDoc(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): Promise<LexicalTextEditsResponse> {
  const openai = createOpenAI({ apiKey: options.apiKey })

  const result = await generateText({
    model: openai(options.model),
    system: buildPatchSystemPrompt(),
    prompt: buildPatchUserPrompt(options.prompt, options.textNodes),
    abortSignal: options.signal,
    output: Output.object({
      schema: lexicalTextEditsResponseSchema,
    }),
  })

  return result.output as LexicalTextEditsResponse
}

export function patchDocStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): PatchDocStreamingResult {
  const openai = createOpenAI({ apiKey: options.apiKey })

  const result = streamText({
    model: openai(options.model),
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
