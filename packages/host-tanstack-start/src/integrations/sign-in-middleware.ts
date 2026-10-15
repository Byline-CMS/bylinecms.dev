/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createMiddleware } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import {
  passkeyEnrollment,
  passkeyEnrollmentOptions,
  passkeyList,
  passkeyManagementContext,
  passkeyPasswordProof,
  passkeyProof,
  passkeyProofOptions,
  passkeyRemove,
  passkeyRename,
  passkeySignIn,
  passkeySignInOptions,
} from '../server-fns/auth/passkeys.js'
import { adminSignIn } from '../server-fns/auth/sign-in.js'
import { checkPasskeyBody, checkSignInBody } from './sign-in-body.js'

/** Register after CSRF in Start's global requestMiddleware, before RPC deserialization. */
export const passwordSignInMiddleware = createMiddleware().server(async (ctx) => {
  if (ctx.handlerType !== 'serverFn') return ctx.next()
  const matches = (url: string) => {
    const endpoint = new URL(url, ctx.request.url).pathname.replace(/\/$/, '')
    return ctx.pathname === endpoint || ctx.pathname.startsWith(`${endpoint}/`)
  }
  if (matches(adminSignIn.url)) return (await checkSignInBody(ctx.request)) ?? ctx.next()
  const passkeys = [
    passkeyManagementContext,
    passkeySignInOptions,
    passkeySignIn,
    passkeyPasswordProof,
    passkeyProofOptions,
    passkeyProof,
    passkeyEnrollmentOptions,
    passkeyEnrollment,
    passkeyList,
    passkeyRename,
    passkeyRemove,
  ]
  if (!passkeys.some((fn) => matches(fn.url))) return ctx.next()
  setResponseHeader('Cache-Control', 'no-store')
  const rejected = await checkPasskeyBody(ctx.request, matches(passkeyPasswordProof.url))
  if (rejected) {
    rejected.headers.set('Cache-Control', 'no-store')
    return rejected
  }
  return ctx.next()
})
