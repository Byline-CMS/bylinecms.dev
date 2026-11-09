import { createRootRoute } from '@tanstack/react-router'

import { passkeySignInOptions } from '../../../../../../packages/host-tanstack-start/src/server-fns/auth/passkeys'
import { adminSignIn } from '../../../../../../packages/host-tanstack-start/src/server-fns/auth/sign-in'

// A production build registers only the server functions client code reaches,
// so the root route references the functions run.mjs calls over HTTP.
const reached = [adminSignIn, passkeySignInOptions]
export const Route = createRootRoute({ component: () => (reached.length ? null : null) })
