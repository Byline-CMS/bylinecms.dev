/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) Infonomic Company Limited
 */

import type { SignInResult, SignInWithPasswordArgs } from './session-provider.js'

/** JSON wire contracts; no browser globals or server cryptography are imported here. */
interface PasskeyAuthenticationOptions {
  challenge: string
  rpId: string
  timeout?: number
  userVerification: 'required'
  allowCredentials?: { id: string; type: 'public-key'; transports?: string[] }[]
}

interface PasskeyRegistrationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout?: number
  attestation: 'none'
  authenticatorSelection: { residentKey: 'required'; userVerification: 'required' }
  excludeCredentials?: { id: string; type: 'public-key'; transports?: string[] }[]
  extensions?: { credProps: true }
}

interface PasskeyCeremony<TOptions> {
  /** Unpredictable bearer identifier. Submit in request bodies; never log or put in URLs. */
  ceremonyId: string
  expiresAt: string
  options: TOptions
}

/** Verified by the provider on every authenticated operation, including completion. */
interface PasskeySession {
  accessToken: string
  expectedSessionId: string
}

/** Enrollment is always self-service. Removal may target an authorized recovery account. */
type PasskeyManagementAction =
  | { purpose: 'enroll' }
  | { purpose: 'remove'; targetUserId: string; credentialRecordId: string }

interface PasskeyManagementGrant {
  /** Single-use, purpose-bound bearer authorization; not a login or OAuth consent token. */
  grantId: string
  expiresAt: string
}

interface PasskeyCredentialSummary {
  /** Internal record identity, never the WebAuthn credential ID or public key. */
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

interface PasskeyRequestMetadata {
  ip?: string
  userAgent?: string
}

/**
 * Optional provider capability. Implementations authenticate the current login themselves;
 * a supplied user ID never authorizes issuance or management. Untrusted ceremony responses
 * stay unknown until the provider's bounded structural and cryptographic validation.
 * Host endpoints enforce admission, CSRF and the expected-login boundary as well.
 */
export interface PasskeyProvider {
  signInOptions(
    metadata: PasskeyRequestMetadata
  ): Promise<PasskeyCeremony<PasskeyAuthenticationOptions>>
  verifySignIn(
    args: PasskeyRequestMetadata &
      Pick<SignInWithPasswordArgs, 'previousAccessToken' | 'previousRefreshToken'> & {
        ceremonyId: string
        response: unknown
      }
  ): Promise<SignInResult>
  passwordProof(
    args: PasskeySession & { password: string; action: PasskeyManagementAction }
  ): Promise<PasskeyManagementGrant>
  proofOptions(
    args: PasskeySession & { action: PasskeyManagementAction }
  ): Promise<PasskeyCeremony<PasskeyAuthenticationOptions>>
  verifyProof(
    args: PasskeySession & { ceremonyId: string; response: unknown }
  ): Promise<PasskeyManagementGrant>
  enrollmentOptions(
    args: PasskeySession & { grantId: string }
  ): Promise<PasskeyCeremony<PasskeyRegistrationOptions>>
  verifyEnrollment(
    args: PasskeySession & { ceremonyId: string; response: unknown; name: string }
  ): Promise<PasskeyCredentialSummary>
  listCredentials(
    args: PasskeySession & { targetUserId?: string }
  ): Promise<PasskeyCredentialSummary[]>
  renameCredential(
    args: PasskeySession & { credentialRecordId: string; name: string }
  ): Promise<PasskeyCredentialSummary>
  /** Target and action come from the consumed grant; removal revokes every target login. */
  removeCredential(args: PasskeySession & { grantId: string }): Promise<{ signedOut: boolean }>
}
