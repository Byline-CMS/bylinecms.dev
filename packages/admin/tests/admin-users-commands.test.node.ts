/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  AdminAuth,
  AuthError,
  AuthErrorCodes,
  createRequestContext,
  createSuperAdminContext,
  type RequestContext,
} from '@byline/auth'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { ADMIN_USERS_ABILITIES } from '../src/modules/admin-users/abilities.js'
import {
  createAdminUserCommand,
  deleteAdminUserCommand,
  disableAdminUserCommand,
  enableAdminUserCommand,
  getAdminUserCommand,
  listAdminUsersCommand,
  setAdminUserPasswordCommand,
  updateAdminUserCommand,
} from '../src/modules/admin-users/commands.js'
import { createInMemoryAdminUsersRepository } from './fixtures/in-memory-admin-users-repository.js'
import type { AdminStore } from '../src/store.js'

function makeDeps(): { store: AdminStore } {
  // The admin-users commands only touch `adminUsers`. The other store
  // slots are stubbed with minimal no-op shapes so we get a typechecked
  // `AdminStore` without wiring fakes we do not exercise here.
  const store: AdminStore = {
    adminUsers: createInMemoryAdminUsersRepository(),
    adminRoles: undefined as never,
    adminPermissions: undefined as never,
    refreshTokens: undefined as never,
  }
  return { store }
}

function contextWith(
  abilities: string[],
  id = '00000000-0000-7000-8000-000000000001'
): RequestContext {
  return createRequestContext({
    actor: new AdminAuth({ id, abilities, isSuperAdmin: false }),
  })
}

describe('admin-users commands', () => {
  describe('validation', () => {
    it('createAdminUserCommand rejects invalid input with ZodError', async () => {
      const deps = makeDeps()
      const context = createSuperAdminContext()
      await expect(
        createAdminUserCommand(context, { email: 'not-an-email', password: 'short' }, deps)
      ).rejects.toBeInstanceOf(ZodError)
    })

    it('updateAdminUserCommand rejects an empty patch', async () => {
      const deps = makeDeps()
      const context = createSuperAdminContext()
      await expect(
        updateAdminUserCommand(
          context,
          { id: '00000000-0000-7000-8000-000000000001', vid: 1, patch: {} },
          deps
        )
      ).rejects.toBeInstanceOf(ZodError)
    })

    it('updateAdminUserCommand rejects missing vid', async () => {
      const deps = makeDeps()
      const context = createSuperAdminContext()
      await expect(
        updateAdminUserCommand(
          context,
          { id: '00000000-0000-7000-8000-000000000001', patch: { given_name: 'Alice' } },
          deps
        )
      ).rejects.toBeInstanceOf(ZodError)
    })

    it('setAdminUserPasswordCommand rejects a short password', async () => {
      const deps = makeDeps()
      const context = createSuperAdminContext()
      await expect(
        setAdminUserPasswordCommand(
          context,
          { id: '00000000-0000-7000-8000-000000000001', vid: 1, password: 'short' },
          deps
        )
      ).rejects.toBeInstanceOf(ZodError)
    })

    it('listAdminUsersCommand accepts an empty input and applies defaults', async () => {
      const deps = makeDeps()
      const context = createSuperAdminContext()
      const response = await listAdminUsersCommand(context, {}, deps)
      expect(response.meta.page).toBe(1)
      expect(response.meta.page_size).toBe(20)
      expect(response.meta.order).toBe('created_at')
      expect(response.meta.desc).toBe(true)
    })
  })

  describe('ability gating', () => {
    it('rejects missing context with ERR_UNAUTHENTICATED', async () => {
      const deps = makeDeps()
      await expect(
        getAdminUserCommand(undefined, { id: '00000000-0000-7000-8000-000000000001' }, deps)
      ).rejects.toMatchObject({ code: AuthErrorCodes.UNAUTHENTICATED })
    })

    it('rejects anonymous (null actor) with ERR_UNAUTHENTICATED', async () => {
      const deps = makeDeps()
      const context = createRequestContext({ actor: null })
      await expect(
        getAdminUserCommand(context, { id: '00000000-0000-7000-8000-000000000001' }, deps)
      ).rejects.toMatchObject({ code: AuthErrorCodes.UNAUTHENTICATED })
    })

    it('rejects a non-super-admin without the required ability with ERR_FORBIDDEN', async () => {
      const deps = makeDeps()
      const context = contextWith([]) // no abilities, not super-admin
      await expect(
        createAdminUserCommand(
          context,
          { email: 'alice@example.com', password: 'correct-horse-battery-staple' },
          deps
        )
      ).rejects.toMatchObject({ code: AuthErrorCodes.FORBIDDEN })
    })

    it('accepts a non-super-admin who holds the required ability', async () => {
      const deps = makeDeps()
      const context = contextWith([ADMIN_USERS_ABILITIES.create])
      const response = await createAdminUserCommand(
        context,
        { email: 'alice@example.com', password: 'correct-horse-battery-staple' },
        deps
      )
      expect(response.email).toBe('alice@example.com')
    })

    it('AuthError subclass for ERR_UNAUTHENTICATED is AuthError', async () => {
      const deps = makeDeps()
      try {
        await getAdminUserCommand(undefined, { id: '00000000-0000-7000-8000-000000000001' }, deps)
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
      }
    })
  })

  describe('happy paths (via super-admin context)', () => {
    it('create → get → update → disable → delete', async () => {
      const deps = makeDeps()
      const actorId = '00000000-0000-7000-8000-00000000aaaa'
      const context = createSuperAdminContext({ id: actorId })

      const created = await createAdminUserCommand(
        context,
        {
          email: 'alice@example.com',
          password: 'correct-horse-battery-staple',
          given_name: 'Alice',
          is_enabled: true,
        },
        deps
      )
      expect(created.email).toBe('alice@example.com')

      const fetched = await getAdminUserCommand(context, { id: created.id }, deps)
      expect(fetched.given_name).toBe('Alice')

      const updated = await updateAdminUserCommand(
        context,
        { id: created.id, vid: created.vid, patch: { family_name: 'Adams' } },
        deps
      )
      expect(updated.family_name).toBe('Adams')
      expect(updated.vid).toBe(created.vid + 1)

      const enabled = await enableAdminUserCommand(context, { id: created.id }, deps)
      expect(enabled.ok).toBe(true)

      const disabled = await disableAdminUserCommand(context, { id: created.id }, deps)
      expect(disabled.ok).toBe(true)
      const afterDisable = await getAdminUserCommand(context, { id: created.id }, deps)
      expect(afterDisable.is_enabled).toBe(false)

      const pw = await setAdminUserPasswordCommand(
        context,
        { id: created.id, vid: afterDisable.vid, password: 'new-password-12chars' },
        deps
      )
      expect(pw.ok).toBe(true)

      const afterPassword = await getAdminUserCommand(context, { id: created.id }, deps)
      const del = await deleteAdminUserCommand(
        context,
        { id: created.id, vid: afterPassword.vid },
        deps
      )
      expect(del.ok).toBe(true)
    })

    it('refuses self-delete even for a super-admin', async () => {
      const deps = makeDeps()
      const actorId = '00000000-0000-7000-8000-000000000abc'
      const context = createSuperAdminContext({ id: actorId })

      // Seed a row with the super-admin's id so deleteUser finds a
      // target to attempt deletion on (it checks self-id before NOT_FOUND).
      ;(deps.store.adminUsers as ReturnType<typeof createInMemoryAdminUsersRepository>).__seed({
        id: actorId,
        vid: 1,
        email: 'root@byline.local',
        password_hash: '$argon2id$v=19$m=19456,t=2,p=1$whatever$whatever',
        given_name: null,
        family_name: null,
        username: null,
        remember_me: false,
        last_login: null,
        last_login_ip: null,
        failed_login_attempts: 0,
        is_super_admin: true,
        is_enabled: true,
        is_email_verified: true,
        created_at: new Date(),
        updated_at: new Date(),
      })

      await expect(
        deleteAdminUserCommand(context, { id: actorId, vid: 1 }, deps)
      ).rejects.toMatchObject({
        code: 'admin.users.selfDeleteForbidden',
      })
    })
  })
})
