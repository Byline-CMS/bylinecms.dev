/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only surface for `@byline/ai`.
 *
 * Pulls in the AI execution code (pino, the Anthropic/OpenAI/Google
 * SDKs, etc.). Import from this entry only on the server — typically
 * from a TanStack Start server function or a Node-side route handler.
 *
 * Browser code should import from `@byline/ai` (the root entry) for
 * types, the public config provider, and provider/model helpers.
 */

export { getAiServerConfig } from './config/ai-config'
export { executeInstruction, executeInstructionStreaming } from './execute'
export { generateStructured, generateStructuredStreaming } from './generate'
export { patch, patchStreaming } from './patch'
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
