import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { sessionRequestMiddleware } from '../../../../../packages/host-tanstack-start/src/integrations/session-request-middleware'
import { passwordSignInMiddleware } from '../../../../../packages/host-tanstack-start/src/integrations/sign-in-middleware'
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === 'serverFn' }),
    sessionRequestMiddleware,
    passwordSignInMiddleware,
  ],
}))
