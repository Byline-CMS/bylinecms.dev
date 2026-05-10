import { z } from 'zod'

export const PROVIDERS = ['openai', 'google', 'anthropic'] as const

export const INSTRUCTION_MODES = ['new', 'new_with_context', 'patch'] as const
export type InstructionMode = (typeof INSTRUCTION_MODES)[number]

export type OutputPreference =
  | { type: 'structured' }
  | { type: 'html' }
  | { type: 'text'; length: 'short' | 'long'; maxLength?: number }

export type ExecuteInstructionInput =
  | { type: 'structured'; editorJson: string }
  | { type: 'text'; text: string }

export type ExecuteInstructionParams = {
  prompt: string
  mode: InstructionMode
  input: ExecuteInstructionInput
  sdk: InstructionSdk
  provider: Provider
  model: string
  output?: OutputPreference
}

export type ExecuteInstructionOptions = {
  streaming?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  telemetryContext?: Record<string, unknown>
}

export type ExecuteInstruction = {
  params: ExecuteInstructionParams
  options?: ExecuteInstructionOptions
}

export const SDKS = ['native', 'vercel'] as const
export type Sdk = (typeof SDKS)[number]

export const normalizeSdk = (value: unknown): Sdk => {
  if (typeof value !== 'string') return 'native'
  const normalized = value.trim().toLowerCase()
  return normalized === 'vercel' ? 'vercel' : 'native'
}

export interface InstructionState {
  errors: {
    prompt?: string[] | undefined
    editor?: string[] | undefined
  }
  message?: string
  editor?: any
  html?: string
  text?: string
  format?: 'lexical' | 'html' | 'text'
  prompt?: string
  lastRun?: number | null
  status: 'success' | 'failed' | 'idle'
}

const outputPreferenceSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('structured') }),
    z.object({ type: z.literal('html') }),
    z.object({
      type: z.literal('text'),
      length: z.enum(['short', 'long']),
      maxLength: z.number().optional(),
    }),
  ])
  .optional()

const inputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('structured'),
    editorJson: z.string({
      error: (issue) =>
        issue.input === undefined ? 'Editor state is required.' : 'Editor state must be a string.',
    }),
  }),
  z.object({
    type: z.literal('text'),
    text: z.string({
      error: (issue) =>
        issue.input === undefined ? 'Input text is required.' : 'Input text must be a string.',
    }),
  }),
])

export const instructionSchema = z.object({
  prompt: z
    .string({
      error: (issue) =>
        issue.input === undefined ? 'Prompt input is required.' : 'Prompt input must be a string.',
    })
    .min(3, {
      error: 'Prompt input must be 3 or more characters long.',
    })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, 'Prompt input cannot be empty.'),
  mode: z.enum(INSTRUCTION_MODES, {
    error: 'Mode must be one of new, new_with_context, or patch.',
  }),
  input: inputSchema,
  provider: z.enum(PROVIDERS, {
    error: 'Provider must be one of openai, google, or anthropic.',
  }),
  model: z.string({
    error: (issue) =>
      issue.input === undefined ? 'Model is required.' : 'Model must be a string.',
  }),
  sdk: z.enum(SDKS, {
    error: 'SDK must be one of native or vercel.',
  }),
  output: outputPreferenceSchema,
})

export type Provider = z.infer<typeof instructionSchema>['provider']
export type InstructionSdk = z.infer<typeof instructionSchema>['sdk']
