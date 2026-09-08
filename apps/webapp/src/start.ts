/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { sessionRequestMiddleware } from '@byline/host-tanstack-start/integrations/session-request-middleware'
import { passwordSignInMiddleware } from '@byline/host-tanstack-start/integrations/sign-in-middleware'
import { bylineCodedErrorAdapter } from '@byline/host-tanstack-start/integrations/start-errors'

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  serializationAdapters: [bylineCodedErrorAdapter],
  requestMiddleware: [csrfMiddleware, sessionRequestMiddleware, passwordSignInMiddleware],
}))
