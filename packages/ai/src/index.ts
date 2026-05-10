export { INSTRUCTION_MODES } from './@types'
export { DEFAULT_MODELS, getAiServerConfig, PROVIDER_MODELS } from './config/ai-config'
export { executeInstruction, executeInstructionStreaming } from './execute'
export { generateStructured, generateStructuredStreaming } from './generate'
export { patch, patchStreaming } from './patch'
export type {
  ExecuteInstruction,
  ExecuteInstructionOptions,
  ExecuteInstructionParams,
  InstructionMode,
  InstructionState,
  OutputPreference,
  Provider,
  Sdk,
} from './@types'
export type { ExecuteInstructionStreamingResult } from './execute'
export type {
  GenerateError,
  GenerateOptions,
  GenerateResult,
  GenerateStreamingResult,
} from './generate'
export type {
  PatchError,
  PatchOptions,
  PatchResult,
  PatchStreamingResult,
} from './patch'

import { DEFAULT_MODELS } from './config/ai-config'
import type { Provider, Sdk } from './@types'

export const PROVIDERS: Array<[Provider, string]> = [
  ['openai', 'OpenAI'],
  ['google', 'Google'],
  ['anthropic', 'Anthropic'],
]

export const SDKS: Sdk[] = ['native', 'vercel']

export const isProvider = (value: string): value is Provider => {
  return value === 'openai' || value === 'google' || value === 'anthropic'
}

export const getDefaultModel = (provider: Provider): string => {
  if (!isProvider(provider)) {
    throw new Error(`Invalid provider: ${provider}`)
  }
  return DEFAULT_MODELS[provider]
}

export const normalizeSdk = (value: unknown): Sdk => {
  if (typeof value !== 'string') return 'native'
  const normalized = value.trim().toLowerCase()
  return normalized === 'vercel' ? 'vercel' : 'native'
}
