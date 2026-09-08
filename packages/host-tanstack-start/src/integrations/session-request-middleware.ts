/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createMiddleware } from '@tanstack/react-start'

import { recordSessionRequestKind } from './session-request-kind.js'

/** Register after CSRF. Classifies SSR separately from remotely invoked business functions. */
export const sessionRequestMiddleware = createMiddleware().server(async (ctx) => {
  recordSessionRequestKind(ctx.request, ctx.handlerType)
  return ctx.next()
})
