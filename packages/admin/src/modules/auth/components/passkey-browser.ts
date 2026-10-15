/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PasskeyManagementAction } from '@byline/auth'
import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'

import type {
  PasskeyAdminServices,
  PasskeyPageBinding,
} from '../../../services/admin-services-types.js'

function ready(binding: PasskeyPageBinding, expiresAt?: string) {
  binding.assertCurrent()
  if (expiresAt && Date.parse(expiresAt) <= Date.now())
    throw Object.assign(new Error('Expired ceremony'), { code: 'ERR_INVALID_TOKEN' })
}
function supported() {
  if (!browserSupportsWebAuthn())
    throw Object.assign(new Error('WebAuthn unavailable'), { code: 'PASSKEY_UNSUPPORTED' })
}
export async function signInWithPasskey(
  services: PasskeyAdminServices,
  isActive: () => boolean = () => true
) {
  supported()
  const captured = services.captureLogin(true)
  const binding = {
    ...captured,
    assertCurrent: () => {
      if (!isActive()) throw new Error('Sign-in page closed')
      captured.assertCurrent()
    },
  }
  const ceremony = await services.signInOptions({ data: {} })
  ready(binding, ceremony.expiresAt)
  const response = await startAuthentication({
    optionsJSON: ceremony.options as PublicKeyCredentialRequestOptionsJSON,
  })
  ready(binding, ceremony.expiresAt)
  return services.signIn({ data: { ceremonyId: ceremony.ceremonyId, response } }, binding)
}

export async function provePasskeyAction(
  services: PasskeyAdminServices,
  binding: PasskeyPageBinding,
  action: PasskeyManagementAction,
  password?: string
) {
  ready(binding)
  const expectedSessionId = binding.expectedSessionId
  if (!expectedSessionId)
    throw Object.assign(new Error('Login changed'), { code: 'ERR_SESSION_CHANGED' })
  if (password !== undefined) {
    const grant = await services.passwordProof({ data: { expectedSessionId, action, password } })
    ready(binding, grant.expiresAt)
    return grant
  }
  supported()
  const ceremony = await services.proofOptions({ data: { expectedSessionId, action } })
  ready(binding, ceremony.expiresAt)
  const response = await startAuthentication({
    optionsJSON: ceremony.options as PublicKeyCredentialRequestOptionsJSON,
  })
  ready(binding, ceremony.expiresAt)
  const grant = await services.proof({
    data: { expectedSessionId, ceremonyId: ceremony.ceremonyId, response },
  })
  ready(binding, grant.expiresAt)
  return grant
}

export async function enrollPasskey(
  services: PasskeyAdminServices,
  binding: PasskeyPageBinding,
  name: string,
  password?: string
) {
  supported()
  const grant = await provePasskeyAction(services, binding, { purpose: 'enroll' }, password)
  const expectedSessionId = binding.expectedSessionId!
  const ceremony = await services.enrollmentOptions({
    data: { expectedSessionId, grantId: grant.grantId },
  })
  ready(binding, ceremony.expiresAt)
  const response = await startRegistration({
    optionsJSON: ceremony.options as PublicKeyCredentialCreationOptionsJSON,
  })
  ready(binding, ceremony.expiresAt)
  return services.enrollment({
    data: { expectedSessionId, ceremonyId: ceremony.ceremonyId, response, name },
  })
}

/** Render fixed translated messages, never provider payloads or authenticator identifiers. */
export function passkeyErrorKey(error: unknown): string {
  const value = error as {
    code?: string
    name?: string
    cause?: { name?: string }
    status?: number
  } | null
  const name = value?.cause?.name ?? value?.name
  if (
    name === 'AbortError' ||
    name === 'NotAllowedError' ||
    value?.code === 'ERROR_CEREMONY_ABORTED'
  )
    return 'passkeys.errors.cancelled'
  if (
    name === 'ConstraintError' ||
    name === 'NotSupportedError' ||
    value?.code === 'PASSKEY_UNSUPPORTED' ||
    value?.code?.startsWith('ERROR_AUTHENTICATOR_MISSING_') ||
    value?.code === 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG'
  )
    return 'passkeys.errors.unsupported'
  if (name === 'UnknownError' || value?.code === 'ERROR_AUTHENTICATOR_GENERAL_ERROR')
    return 'passkeys.errors.device'
  if (value?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
    return 'passkeys.errors.duplicate'
  if (value?.code === 'ERR_INVALID_TOKEN') return 'passkeys.errors.expired'
  if (value?.code === 'ERR_SESSION_CHANGED') return 'passkeys.errors.sessionChanged'
  if (value?.code === 'ERR_PASSKEY_LIMIT') return 'passkeys.errors.limit'
  if (value?.code === 'ERR_FORBIDDEN') return 'passkeys.errors.forbidden'
  if (value?.code === 'ERR_INVALID_CREDENTIALS') return 'passkeys.errors.proof'
  if (value?.status === 429) return 'passkeys.errors.rateLimited'
  return 'passkeys.errors.unavailable'
}
