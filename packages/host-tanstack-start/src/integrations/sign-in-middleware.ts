/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createMiddleware } from '@tanstack/react-start'

import { adminSignIn } from '../server-fns/auth/sign-in.js'
import { checkSignInBody } from './sign-in-body.js'

/** Register after CSRF in Start's global requestMiddleware, before RPC deserialization. */
export const passwordSignInMiddleware = createMiddleware().server(async (ctx) => {
  const endpoint = new URL(adminSignIn.url, ctx.request.url).pathname.replace(/\/$/, '')
  if (
    ctx.handlerType !== 'serverFn' ||
    (ctx.pathname !== endpoint && !ctx.pathname.startsWith(`${endpoint}/`))
  )
    return ctx.next()
  const rejected = await checkSignInBody(ctx.request)
  return rejected ?? ctx.next()
})
