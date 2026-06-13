/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-only AI execute server function.
 *
 * Accepts an `ExecuteInstruction` payload, calls
 * `executeInstruction` / `executeInstructionStreaming` from `@byline/ai`,
 * and returns the result as a `Response` — JSON for non-streaming and
 * NDJSON (`{ type: 'delta' | 'final' | 'error' }` lines) for streaming.
 *
 * Auth is enforced by `getAdminRequestContext()`, which throws
 * `ERR_UNAUTHENTICATED` when no valid admin session is present.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ExecuteInstructionOptions, ExecuteInstructionParams } from '@byline/ai'
// Server-only execute API — kept on the `/server` subpath so the browser
// barrel for `@byline/ai` stays free of pino + the provider SDKs.
import { executeInstruction, executeInstructionStreaming } from '@byline/ai/server'

import { getAdminRequestContext } from '../../auth/auth-context.js'

/**
 * Wire shape — the same as `ExecuteInstruction` minus the in-process-only
 * `signal` (an AbortSignal can't be serialized across the RPC boundary;
 * the client passes its signal separately as a fetcher option).
 */
type ExecuteAiInstructionInput = {
  params: ExecuteInstructionParams
  options?: Omit<ExecuteInstructionOptions, 'signal'>
}

export const executeAiInstruction = createServerFn({ method: 'POST' })
  .validator((input: ExecuteAiInstructionInput) => input)
  .handler(async ({ data }): Promise<Response> => {
    // Throws ERR_UNAUTHENTICATED if there is no admin session.
    await getAdminRequestContext()

    if (data.options?.streaming) {
      const streamResult = executeInstructionStreaming(data.params, data.options)
      const ndjson = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          const enqueue = (obj: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
          }
          try {
            for await (const chunk of streamResult.text) {
              enqueue({ type: 'delta', text: chunk })
            }
            const finalState = await streamResult.final
            enqueue({ type: 'final', state: finalState })
          } catch (err) {
            enqueue({
              type: 'error',
              message: err instanceof Error ? err.message : 'AI stream error',
            })
          } finally {
            controller.close()
          }
        },
      })
      return new Response(ndjson, {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      })
    }

    const state = await executeInstruction(data.params, data.options)
    return new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  })
