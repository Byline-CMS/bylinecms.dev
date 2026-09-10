// Only application services are substituted. Start, its HTTP transport, and all
// sign-in middleware/handler code are real, including Request identity checks.
export const getServerConfig = () => ({
  sessionProvider: { signInWithPassword: async () => ({ actor: { id: 'transport-verified' } }) },
  passwordSignIn: {
    resolveClientIp: () => '192.0.2.1',
    limiter: {
      acquire: async () => () => {},
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    },
  },
})
export const setSessionCookies = () => {}
// The sign-in handler reads both credential cookies for replacement revocation.
export const readAccessTokenCookie = () => undefined
export const readRefreshTokenCookie = () => undefined
export const readAdminLocaleCookie = () => null
export const bylineCore = () => {
  throw new Error('Locale reconciliation should not run')
}
