import { describe, expect, expectTypeOf, it } from 'vitest'

import type { PasskeyProvider } from './index.js'

type PasskeyManagementAction = Parameters<PasskeyProvider['passwordProof']>[0]['action']

import type { SessionProvider, SignInResult } from './session-provider.js'

const unsupported = async (): Promise<never> => {
  throw new Error('not used')
}
const legacyProvider = {
  capabilities: { passwordChange: true, magicLink: false, sso: false },
  signInWithPassword: unsupported,
  verifyAccessToken: unsupported,
  refreshSession: unsupported,
  revokeSession: unsupported,
  resolveActor: unsupported,
} satisfies SessionProvider

describe('additive passkey provider contracts', () => {
  it('accepts an existing provider without passkey fields', () => {
    const provider: SessionProvider = legacyProvider
    expect(provider.passkeys).toBeUndefined()
    expect(provider.capabilities.passkeys).toBeUndefined()
  })

  it('keeps session issuance and purpose-bound management separate', () => {
    expectTypeOf<ReturnType<PasskeyProvider['verifySignIn']>>().toEqualTypeOf<
      Promise<SignInResult>
    >()
    const enroll: PasskeyManagementAction = { purpose: 'enroll' }
    const remove: PasskeyManagementAction = {
      purpose: 'remove',
      targetUserId: 'target',
      credentialRecordId: 'credential',
    }
    expect(enroll.purpose).toBe('enroll')
    expect(remove.purpose).toBe('remove')
    // @ts-expect-error Removal must bind the exact target account and credential.
    const unboundRemoval: PasskeyManagementAction = { purpose: 'remove' }
    // @ts-expect-error OAuth consent is not a credential-management proof purpose.
    const consent: PasskeyManagementAction = { purpose: 'oauth-consent' }
    // @ts-expect-error The optional capability cannot be implemented by sign-in alone.
    const incomplete: PasskeyProvider = { signInOptions: unsupported }
    void [unboundRemoval, consent, incomplete]
  })
})
