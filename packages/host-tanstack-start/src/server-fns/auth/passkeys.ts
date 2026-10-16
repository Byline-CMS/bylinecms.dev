/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'

import {
  ERR_SESSION_CHANGED,
  ERR_UNAUTHENTICATED,
  isAdminAuth,
  type PasskeyOperation,
  type PasskeyProvider,
} from '@byline/auth'
import {
  clearPreviewCookie,
  clearSessionCookies,
  getAdminRequestContext,
  readAccessTokenCookie,
  readRefreshTokenCookie,
  setSessionCookies,
} from '@byline/client/server'
import { getServerConfig } from '@byline/core'
import { z } from 'zod'

import { bylineCore } from '../../integrations/byline-core.js'
import {
  adminSessionMiddleware,
  adminSessionMutationMiddleware,
} from '../../integrations/session-middleware.js'
import { wasPasskeyBodyChecked } from '../../integrations/sign-in-body.js'
import { withPasskeyAdmission } from './passkey-admission.js'
import { reconcileLocaleAfterSignIn } from './reconcile-locale.js'

const session = z.object({ expectedSessionId: z.uuid() })
const bearer = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const action = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('enroll') }).strict(),
  z
    .object({ purpose: z.literal('remove'), targetUserId: z.uuid(), credentialRecordId: z.uuid() })
    .strict(),
])
const name = z.string().trim().min(1).max(80)
function validate<T>(schema: z.ZodType<T>) {
  return (input: unknown): T => {
    const parsed = schema.safeParse(input)
    if (!parsed.success)
      throw new Response('Invalid passkey input', {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      })
    return parsed.data
  }
}

function configuredProvider(): PasskeyProvider {
  setResponseHeader('Cache-Control', 'no-store')
  const config = getServerConfig()
  const provider = config.sessionProvider
  if (!config.passkeys || provider?.capabilities?.passkeys !== true || !provider.passkeys)
    throw new Response('Passkeys are not enabled', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  return provider.passkeys
}

async function currentSession(expectedSessionId: string) {
  const auth = await getAdminRequestContext()
  if (auth.sessionId !== expectedSessionId)
    throw ERR_SESSION_CHANGED({ message: 'session changed before passkey operation' })
  const accessToken = readAccessTokenCookie()
  if (!accessToken) throw ERR_UNAUTHENTICATED({ message: 'access credential missing' })
  return { accessToken, expectedSessionId }
}

function admitted<T>(
  purpose: PasskeyOperation,
  work: (provider: PasskeyProvider, metadata: { ip: string; userAgent?: string }) => Promise<T>,
  expectedSessionId?: string
) {
  const provider = configuredProvider()
  const config = getServerConfig()
  const request = getRequest()
  return withPasskeyAdmission({
    provider,
    purpose,
    request,
    bodyChecked: wasPasskeyBodyChecked(request, purpose === 'password-proof'),
    protection: config.passkeyRequests,
    ...(purpose === 'password-proof'
      ? {
          password: {
            protection: config.passwordSignIn,
            resolveActorEmail: async () => {
              const auth = await getAdminRequestContext()
              if (!auth.actor || !expectedSessionId || auth.sessionId !== expectedSessionId)
                throw ERR_SESSION_CHANGED({ message: 'session changed before password proof' })
              const user = await bylineCore().adminStore?.adminUsers.getById(auth.actor.id)
              if (!user) throw ERR_UNAUTHENTICATED({ message: 'account unavailable' })
              return user.email
            },
          },
        }
      : {}),
    work: ({ ip }) =>
      work(provider, { ip, userAgent: request.headers.get('user-agent')?.slice(0, 512) }),
  })
}

/** Cosmetic capability discovery creates no ceremony and reads no account data. */
export const getPasskeyCapability = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const config = getServerConfig()
  return {
    enabled: !!(
      config.passkeys &&
      config.sessionProvider?.capabilities?.passkeys &&
      config.sessionProvider.passkeys
    ),
  }
})

export const passkeySignInOptions = createServerFn({ method: 'POST' })
  .validator(validate(z.object({}).strict()))
  .handler(async () =>
    admitted('sign-in-options', (provider, metadata) => provider.signInOptions(metadata))
  )

export const passkeySignIn = createServerFn({ method: 'POST' })
  .validator(validate(z.object({ ceremonyId: bearer, response: z.unknown() }).strict()))
  .handler(async ({ data }) =>
    admitted('sign-in', async (provider, metadata) => {
      const result = await provider.verifySignIn({
        ...data,
        ...metadata,
        previousAccessToken: readAccessTokenCookie(),
        previousRefreshToken: readRefreshTokenCookie(),
      })
      setSessionCookies(result)
      try {
        await reconcileLocaleAfterSignIn(result.actor.id)
      } catch {
        /* Locale is best effort. */
      }
      return { userId: result.actor.id, sessionId: result.sessionId }
    })
  )

export const passkeyPasswordProof = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ password: z.string().min(1).max(128), action }).strict()))
  .handler(async ({ data }) =>
    admitted(
      'password-proof',
      async (provider) =>
        provider.passwordProof({ ...data, ...(await currentSession(data.expectedSessionId)) }),
      data.expectedSessionId
    )
  )

export const passkeyProofOptions = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ action }).strict()))
  .handler(async ({ data }) =>
    admitted('proof-options', async (provider) =>
      provider.proofOptions({ ...data, ...(await currentSession(data.expectedSessionId)) })
    )
  )

export const passkeyProof = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ ceremonyId: bearer, response: z.unknown() }).strict()))
  .handler(async ({ data }) =>
    admitted('proof', async (provider) =>
      provider.verifyProof({ ...data, ...(await currentSession(data.expectedSessionId)) })
    )
  )

export const passkeyEnrollmentOptions = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ grantId: bearer }).strict()))
  .handler(async ({ data }) =>
    admitted('enrollment-options', async (provider) =>
      provider.enrollmentOptions({ ...data, ...(await currentSession(data.expectedSessionId)) })
    )
  )

export const passkeyEnrollment = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ ceremonyId: bearer, response: z.unknown(), name }).strict()))
  .handler(async ({ data }) =>
    admitted('enrollment', async (provider) =>
      provider.verifyEnrollment({ ...data, ...(await currentSession(data.expectedSessionId)) })
    )
  )

export const passkeyList = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ targetUserId: z.uuid().optional() }).strict()))
  .handler(async ({ data }) =>
    admitted('list', async (provider) =>
      provider.listCredentials({ ...data, ...(await currentSession(data.expectedSessionId)) })
    )
  )

export const passkeyRename = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.extend({ credentialRecordId: z.uuid(), name }).strict()))
  .handler(async ({ data }) =>
    admitted('rename', async (provider) =>
      provider.renameCredential({ ...data, ...(await currentSession(data.expectedSessionId)) })
    )
  )

export const passkeyRemove = createServerFn({ method: 'POST' })
  .middleware([adminSessionMutationMiddleware])
  .validator(validate(session.extend({ grantId: bearer }).strict()))
  .handler(async ({ data }) =>
    admitted('remove', async (provider) => {
      const result = await provider.removeCredential({
        ...data,
        ...(await currentSession(data.expectedSessionId)),
      })
      if (result.signedOut) {
        clearSessionCookies()
        clearPreviewCookie()
      }
      return result
    })
  )

/** Cosmetic permissions for the manager; every mutation still rechecks authority. */
export const passkeyManagementContext = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator(validate(session.strict()))
  .handler(async ({ data }) =>
    admitted('list', async () => {
      await currentSession(data.expectedSessionId)
      const { actor } = await getAdminRequestContext()
      if (!isAdminAuth(actor)) throw ERR_UNAUTHENTICATED({ message: 'admin login required' })
      return {
        id: actor.id,
        isSuperAdmin: actor.isSuperAdmin,
        canManagePasskeys: actor.hasAbility('admin.users.managePasskeys'),
      }
    })
  )
