/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Bridges the `@byline/ai` plugins to TanStack Start's RPC transport.
 *
 * The plugins make `fetch(endpoint, init)` calls. We substitute a
 * fetch-shaped adapter that invokes `executeAiInstruction` (a server
 * function with admin-auth enforcement) and returns its `Response` —
 * preserving the NDJSON streaming wire format the plugins already
 * understand.
 *
 * Hosts mount `<BylineAiAdminProvider>` once inside the admin shell.
 */

import type { ReactNode } from 'react'

import {
  AiPublicConfigProvider,
  type ExecuteInstructionOptions,
  type ExecuteInstructionParams,
} from '@byline/ai'

import { executeAiInstruction } from '../server-fns/ai/index.js'

type ExecuteAiInstructionWire = {
  params: ExecuteInstructionParams
  options?: Omit<ExecuteInstructionOptions, 'signal'>
}

/**
 * `fetch`-shaped adapter that dispatches the body to the
 * `executeAiInstruction` server function. The `input` URL is ignored —
 * the server function handles routing and auth.
 */
export const aiFetchAdapter: typeof fetch = async (_input, init) => {
  const bodyText =
    typeof init?.body === 'string'
      ? init.body
      : init?.body == null
        ? ''
        : await new Response(init.body as BodyInit).text()

  let payload: ExecuteAiInstructionWire
  try {
    payload = JSON.parse(bodyText) as ExecuteAiInstructionWire
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return executeAiInstruction({
    data: payload,
    signal: init?.signal ?? undefined,
  })
}

/**
 * Single-line provider mount for the admin shell. Wires `@byline/ai`'s
 * public config to the host-side server function. Set `enabled={false}`
 * to allow wrapper fields to hide AI affordances globally.
 */
export function BylineAiAdminProvider({
  children,
  enabled,
}: {
  children: ReactNode
  enabled?: boolean
}) {
  return (
    <AiPublicConfigProvider config={{ fetch: aiFetchAdapter, enabled }}>
      {children}
    </AiPublicConfigProvider>
  )
}
