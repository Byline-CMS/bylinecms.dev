// Only application services are substituted. Start, HTTP serialization, CSRF,
// body guards, expected-login middleware and cookie decisions are real.
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'

import { AdminAuth, ERR_ACCESS_EXPIRED } from '@byline/auth'
export const sessionId = '00000000-0000-4000-8000-000000000001'
const actor = new AdminAuth({
  id: '00000000-0000-4000-8000-000000000002',
  abilities: [],
  isSuperAdmin: true,
})
const limiter = {
  acquire: async () => () => {},
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}
const protection = { resolveClientIp: () => '192.0.2.1', limiter }
const result = { actor, sessionId }
const ceremony = (purpose: string) => ({
  ceremonyId: 'a'.repeat(43),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  options: { purpose },
})
const grant = { grantId: 'b'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() }
export const getServerConfig = () => ({
  passkeys: {},
  passkeyRequests: protection,
  passwordSignIn: protection,
  sessionProvider: {
    capabilities: { passkeys: true },
    signInWithPassword: async () => ({ ...result, actor: { id: 'transport-verified' } }),
    passkeys: {
      signInOptions: async () => ceremony('sign-in'),
      verifySignIn: async () => result,
      passwordProof: async () => grant,
      proofOptions: async () => ceremony('proof'),
      verifyProof: async () => grant,
      enrollmentOptions: async () => ceremony('enrollment'),
      verifyEnrollment: async () => ({
        id: actor.id,
        name: 'registered',
        createdAt: new Date(0).toISOString(),
        lastUsedAt: null,
      }),
      listCredentials: async () => [],
      renameCredential: async () => ({
        id: actor.id,
        name: 'renamed',
        createdAt: new Date(0).toISOString(),
        lastUsedAt: null,
      }),
      removeCredential: async () => ({
        signedOut: getRequest().headers.get('x-test-self-removal') === 'true',
      }),
    },
  },
})
export const getAdminRequestContext = async () => {
  if (getRequest().headers.get('x-test-expired') === 'true')
    throw ERR_ACCESS_EXPIRED({ message: 'expired' })
  return { actor, sessionId }
}
export const setSessionCookies = () => setResponseHeader('x-test-cookies', 'set')
export const clearSessionCookies = () => setResponseHeader('x-test-cookies', 'cleared')
export const clearPreviewCookie = () => setResponseHeader('x-test-preview', 'cleared')
export const readAccessTokenCookie = () => 'test-access'
export const readRefreshTokenCookie = () => 'test-refresh'
export const readAdminLocaleCookie = () => null
export const bylineCore = () => ({
  adminStore: {
    adminUsers: { getById: async () => ({ id: actor.id, email: 'actor@example.test' }) },
  },
})
