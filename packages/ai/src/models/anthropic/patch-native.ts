import Anthropic from '@anthropic-ai/sdk'

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

const isValidHttpUrl = (value: string | undefined): value is string => {
  if (value == null || value.trim().length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeAnthropicBaseURLForSdk = (value: string | undefined) => {
  const base = (value && value.trim().length > 0 ? value : 'https://api.anthropic.com')
    .trim()
    .replace(/\/+$/, '')

  return base.endsWith('/v1') ? base.slice(0, -3) : base
}

const anthropicPatchSchema = {
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
}

export async function patchDoc(options: {
  apiKey: string
  model: string
  prompt: string
  textNodes: Array<{ id: number; text: string }>
  signal?: AbortSignal
}): Promise<LexicalTextEditsResponse> {
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const toolName = 'patch_lexical_text_nodes_v1'

  const result = await client.messages.create(
    {
      model: options.model,
      max_tokens: 4000,
      system: buildPatchSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildPatchUserPrompt(options.prompt, options.textNodes),
        },
      ],
      tools: [
        {
          name: toolName,
          description: 'Patch Lexical text nodes by returning edits as JSON.',
          input_schema: anthropicPatchSchema as any,
        },
      ],
      tool_choice: { type: 'tool', name: toolName },
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const toolUse = (result.content ?? []).find(
    (c: any) => c?.type === 'tool_use' && c?.name === toolName
  ) as any

  const parsed = toolUse?.input as LexicalTextEditsResponse | undefined
  if (parsed && typeof parsed === 'object') {
    return parsed
  }

  const text = (result.content ?? [])
    .filter((c: any) => c?.type === 'text')
    .map((c: any) => c?.text)
    .filter((t: any) => typeof t === 'string' && t.length > 0)
    .join('\n')

  throw new Error(
    text.length > 0
      ? `Anthropic did not return a tool payload. Text: ${text}`
      : 'Anthropic did not return a tool payload.'
  )
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
  const baseURL = isValidHttpUrl(process.env.ANTHROPIC_BASE_URL)
    ? normalizeAnthropicBaseURLForSdk(process.env.ANTHROPIC_BASE_URL)
    : 'https://api.anthropic.com'

  const client = new Anthropic({ apiKey: options.apiKey, baseURL })

  const toolName = 'patch_lexical_text_nodes_v1'

  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: 4000,
      system: buildPatchSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildPatchUserPrompt(options.prompt, options.textNodes),
        },
      ],
      tools: [
        {
          name: toolName,
          description: 'Patch Lexical text nodes by returning edits as JSON.',
          input_schema: anthropicPatchSchema as any,
        },
      ],
      tool_choice: { type: 'tool', name: toolName },
      stream: true,
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const text = (async function* () {
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const deltaText = (event as any)?.delta?.text
        const deltaJson =
          (event as any)?.delta?.partial_json ??
          (event as any)?.delta?.input_json_delta?.partial_json

        if (typeof deltaText === 'string' && deltaText.length > 0) {
          yield deltaText
        } else if (typeof deltaJson === 'string' && deltaJson.length > 0) {
          yield deltaJson
        }
      }
    }
  })()

  const final = (async () => {
    const result = await stream.finalMessage()

    const toolUse = (result.content ?? []).find(
      (c: any) => c?.type === 'tool_use' && c?.name === toolName
    ) as any

    const parsed = toolUse?.input as LexicalTextEditsResponse | undefined
    if (parsed && typeof parsed === 'object') {
      return parsed
    }

    const text = (result.content ?? [])
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c?.text)
      .filter((t: any) => typeof t === 'string' && t.length > 0)
      .join('\n')

    throw new Error(
      text.length > 0
        ? `Anthropic did not return a tool payload. Text: ${text}`
        : 'Anthropic did not return a tool payload.'
    )
  })()

  return { text, final }
}
