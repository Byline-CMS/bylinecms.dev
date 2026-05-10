/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Browser-safe public surface for `@byline/ai`.
 *
 * Importing this entry pulls only: type definitions, the public config
 * provider, and small provider/model helpers. It does NOT pull in the
 * AI execution code (which depends on pino, the Anthropic/OpenAI/Google
 * SDKs, etc., and would crash in the browser).
 *
 * Server-only execution APIs live at `@byline/ai/server`.
 */

export { INSTRUCTION_MODES } from './@types'
export {
  type AiPublicConfig,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_MODELS,
  getAiPublicConfig,
  PROVIDER_MODELS,
} from './config/ai-config'
export {
  AiPublicConfigContext,
  AiPublicConfigProvider,
  useAiPublicConfig,
  useOptionalAiPublicConfig,
} from './config/ai-provider'
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
