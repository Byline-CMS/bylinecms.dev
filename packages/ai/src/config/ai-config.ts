/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { z } from 'zod'

import type { Provider } from '../@types'

/**
 * Curated model configuration per application version.
 * These are the models suited to text generation for our
 * text and lexical editors. Update this list when adding
 * or retiring models between releases. Use `pnpm list:models`
 * to discover available models from each provider.
 */
export const PROVIDER_MODELS: Record<Provider, string[]> = {
  openai: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-5.4',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-4-5-20251001',
}

export const PROVIDERS: Array<[Provider, string]> = [
  ['openai', 'OpenAI'],
  ['google', 'Google'],
  ['anthropic', 'Anthropic'],
]

export const isProvider = (value: string): value is Provider => {
  return value === 'openai' || value === 'google' || value === 'anthropic'
}

export const getDefaultModel = (provider: Provider): string => {
  if (!isProvider(provider)) {
    throw new Error(`Invalid provider: ${provider}`)
  }
  return DEFAULT_MODELS[provider]
}

/**
 * Server configuration schema and functions. Note that these
 * values are ONLY available on the server and NOT available
 * at build time and therefore not available to the browser.
 * Values here are populated via the projects's .env file
 * which is NOT committed to the project's Git repo and
 * CAN include secrets.
 */
const aiServerSchema = z.object({
  ai: z.object({
    defaultProvider: z.enum(['openai', 'google', 'anthropic']),
    openai: z.object({
      apiKey: z.string(),
      baseUrl: z.string().optional(),
    }),
    google: z.object({
      apiKey: z.string(),
      baseUrl: z.string().optional(),
    }),
    anthropic: z.object({
      apiKey: z.string(),
      baseUrl: z.string().optional(),
    }),
  }),
})

type AiServerConfig = z.infer<typeof aiServerSchema>

const initServerConfig = (): AiServerConfig =>
  aiServerSchema.parse({
    ai: {
      defaultProvider: process.env.AI_DEFAULT_PROVIDER || 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL || undefined,
      },
      google: {
        apiKey: process.env.GOOGLE_API_KEY || '',
        baseUrl: process.env.GOOGLE_BASE_URL || undefined,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
      },
    },
    log: {
      level: process.env.LOG_LEVEL ?? 'info',
      pretty: process.env.LOG_PRETTY,
    },
  })

let cachedAiServerConfig: AiServerConfig

export const getAiServerConfig = (): AiServerConfig => {
  if (cachedAiServerConfig == null) {
    cachedAiServerConfig = initServerConfig()
  }
  return cachedAiServerConfig
}

/**
 * Default path for the AI execute endpoint. Host adapters mount the
 * actual handler at this path (or override via AiPublicConfigProvider).
 */
export const DEFAULT_AI_ENDPOINT = '/api/admin/ai'

/**
 * Public configuration. These values are passed to the browser via
 * <AiPublicConfigProvider> and read by the AI plugins. Must NOT contain
 * secrets — only transport configuration.
 *
 * - `endpoint`: URL the plugins POST `ExecuteInstruction` to
 * - `enabled`: when explicitly `false`, wrappers may hide AI affordances
 * - `fetch`: optional fetch override (auth interceptors, tests, etc.)
 * - `headers`: optional headers merged into every request
 */
const aiPublicSchema = z.object({
  endpoint: z.string().default(DEFAULT_AI_ENDPOINT),
  enabled: z.boolean().optional(),
})

type AiPublicEnvConfig = z.infer<typeof aiPublicSchema>

export type AiPublicConfig = AiPublicEnvConfig & {
  fetch?: typeof fetch
  headers?: HeadersInit
}

const initAiPublicConfig = (): AiPublicEnvConfig =>
  aiPublicSchema.parse({
    endpoint: process.env.BYLINE_AI_ENDPOINT ?? DEFAULT_AI_ENDPOINT,
  })

let cachedAiPublicConfig: AiPublicEnvConfig

export const getAiPublicConfig = (): AiPublicEnvConfig => {
  if (cachedAiPublicConfig == null) {
    cachedAiPublicConfig = initAiPublicConfig()
  }
  return cachedAiPublicConfig
}
