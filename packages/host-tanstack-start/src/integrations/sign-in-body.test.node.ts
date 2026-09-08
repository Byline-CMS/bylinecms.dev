/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { checkSignInBody, SIGN_IN_MAX_BODY_BYTES, wasSignInBodyChecked } from './sign-in-body.js'

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request('https://app.test/_serverFn/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit)
}
describe('sign-in body boundary', () => {
  it('preserves the original body for RPC parsing', async () => {
    const req = request('{"data":{}}')
    expect(await checkSignInBody(req)).toBeUndefined()
    expect(wasSignInBodyChecked(req)).toBe(true)
    expect(await req.json()).toEqual({ data: {} })
    expect(wasSignInBodyChecked(request('{}'))).toBe(false)
  })
  it('rejects oversized declared or actual bodies', async () => {
    expect(
      (
        await checkSignInBody(
          request('{}', { 'content-length': String(SIGN_IN_MAX_BODY_BYTES + 1) })
        )
      )?.status
    ).toBe(413)
    const req = request('x'.repeat(SIGN_IN_MAX_BODY_BYTES + 1), { 'content-length': '1' })
    expect((await checkSignInBody(req))?.status).toBe(413)
    expect(wasSignInBodyChecked(req)).toBe(false)
  })
  it('counts chunked bodies without relying on Content-Length', async () => {
    const req = request(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(SIGN_IN_MAX_BODY_BYTES))
          controller.enqueue(new Uint8Array(1))
          controller.close()
        },
      })
    )
    expect((await checkSignInBody(req))?.status).toBe(413)
  })
  it('rejects multipart and wrong methods', async () => {
    expect(
      (await checkSignInBody(request('{}', { 'content-type': 'multipart/form-data' })))?.status
    ).toBe(415)
    expect((await checkSignInBody(new Request('https://app.test')))?.status).toBe(405)
  })
})
