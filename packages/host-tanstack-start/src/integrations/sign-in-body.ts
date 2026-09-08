/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Limit the serialized RPC envelope, not just its eventual credential fields. */
export const SIGN_IN_MAX_BODY_BYTES = 16 * 1024
const checked = new WeakSet<Request>()

export function wasSignInBodyChecked(request: Request): boolean {
  return checked.has(request)
}

/** Read a bounded clone before Start parses the original. Never await tee cancellation. */
export async function checkSignInBody(request: Request): Promise<Response | undefined> {
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return new Response('Expected JSON', { status: 415 })
  }
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SIGN_IN_MAX_BODY_BYTES)) {
    return new Response('Payload too large', { status: 413 })
  }
  const reader = request.clone().body?.getReader()
  if (!reader) return new Response('Missing body', { status: 400 })
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Body timeout')), 5000)
  })
  try {
    let size = 0
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > SIGN_IN_MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 })
    }
    checked.add(request)
    return undefined
  } catch {
    return new Response('Incomplete request body', { status: 408 })
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
}
