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
 * Public configuration schema and functions. Note that these
 * values are populated via .env.public and NEXT_PUBLIC_... vars
 * which are available at 'build time', and are compiled into
 * the Next.js client application - and therefore shipped to
 * the browser. .env.public is also committed to the project's
 * Git repo - and so it's essential that these values
 * DO NOT contain secrets.
 */
const aiPublicSchema = z.object({})

export type AiPublicConfig = z.infer<typeof aiPublicSchema>

const initAiPublicConfig = () =>
  aiPublicSchema.parse({
    // siteName: process.env.NEXT_PUBLIC_SITE_NAME,
    // siteDescription: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
    // publicServerUrl: process.env.NEXT_PUBLIC_PUBLIC_SERVER_URL,
    // apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    // cspEnabled: process.env.NEXT_PUBLIC_CSP_ENABLED,
    // recaptcha: {
    //   enabled: process.env.NEXT_PUBLIC_RECAPTCHA_ENABLED,
    //   mandatory: process.env.NEXT_PUBLIC_RECAPTCHA_MANDATORY,
    //   siteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
    // },
  })

let cachedAiPublicConfig: AiPublicConfig

export const getAiPublicConfig = (): AiPublicConfig => {
  if (cachedAiPublicConfig == null) {
    cachedAiPublicConfig = initAiPublicConfig()
  }
  return cachedAiPublicConfig
}
