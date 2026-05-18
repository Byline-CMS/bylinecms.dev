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
 * AI execution code (which depends on the Anthropic/OpenAI/Google
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
  getDefaultModel,
  isProvider,
  PROVIDER_MODELS,
  PROVIDERS,
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
} from './@types'
