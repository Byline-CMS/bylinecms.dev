import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { passwordSignInMiddleware } from '../../../../../packages/host-tanstack-start/src/integrations/sign-in-middleware'
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === 'serverFn' }),
    passwordSignInMiddleware,
  ],
}))
