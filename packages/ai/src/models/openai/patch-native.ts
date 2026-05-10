import OpenAI from 'openai'

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

const openaiPatchSchema = {
  name: 'lexical_text_edits_v1',
  strict: true,
  schema: {
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
  },
} as const

export type PatchDocStreamingResult = {
  text: AsyncIterable<string>
  final: Promise<LexicalTextEditsResponse>
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

const parsePatchResponse = (result: any) => {
  const parsed = (result as any).output_parsed as LexicalTextEditsResponse | undefined
  if (parsed && typeof parsed === 'object') {
    return parsed
  }

  const outputText = getOutputText(result)
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    try {
      const json = JSON.parse(outputText)
      if (json && typeof json === 'object') {
        return json as LexicalTextEditsResponse
      }
    } catch {
      // fall through to error below
    }
  }

  throw new Error('OpenAI structured output did not return a parsed object.')
}

export async function patchDoc(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): Promise<LexicalTextEditsResponse> {
  const client = new OpenAI({ apiKey: options.apiKey })

  const format = {
    type: 'json_schema',
    ...openaiPatchSchema,
  } as any

  const result = await client.responses.parse(
    {
      model: options.model,
      input: [
        {
          role: 'system',
          content: buildPatchSystemPrompt(),
        },
        {
          role: 'user',
          content: buildPatchUserPrompt(options.prompt, options.textNodes),
        },
      ],
      text: {
        format,
      },
    },
    options.signal ? { signal: options.signal } : undefined
  )

  // console.log(result.usage)

  const refusal = (result as any)?.output?.[0]?.content?.find(
    (c: any) => c?.type === 'refusal'
  )?.refusal
  if (typeof refusal === 'string' && refusal.length > 0) {
    throw new Error(refusal)
  }

  return parsePatchResponse(result)
}

export function patchDocStreaming(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): PatchDocStreamingResult {
  const client = new OpenAI({ apiKey: options.apiKey })

  const format = {
    type: 'json_schema',
    ...openaiPatchSchema,
  } as any

  const stream = client.responses.stream(
    {
      model: options.model,
      input: [
        {
          role: 'system',
          content: buildPatchSystemPrompt(),
        },
        {
          role: 'user',
          content: buildPatchUserPrompt(options.prompt, options.textNodes),
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

    return parsePatchResponse(result)
  })()

  return { text, final }
}
