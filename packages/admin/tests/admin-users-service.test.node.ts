/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth } from '@byline/auth'
import { describe, expect, it } from 'vitest'

import {
  AdminUsersErrorCodes,
  ERR_ADMIN_USER_EMAIL_IN_USE,
  ERR_ADMIN_USER_NOT_FOUND,
  ERR_ADMIN_USER_SELF_DELETE,
  ERR_ADMIN_USER_SELF_DISABLE,
  ERR_ADMIN_USER_VERSION_CONFLICT,
} from '../src/modules/admin-users/errors.js'
import { AdminUsersService } from '../src/modules/admin-users/service.js'
import { verifyPassword } from '../src/modules/auth/password.js'
import { createInMemoryAdminUsersRepository } from './fixtures/in-memory-admin-users-repository.js'

function makeService() {
  const repo = createInMemoryAdminUsersRepository()
  const service = new AdminUsersService({ repo })
  return { repo, service }
}

function makeActor(id: string): AdminAuth {
  return new AdminAuth({ id, abilities: [], isSuperAdmin: true })
}

describe('AdminUsersService', () => {
  describe('createUser', () => {
    it('hashes the password before storing, and returns a public user with vid=1', async () => {
      const { repo, service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
        given_name: 'Alice',
        is_enabled: true,
      })

      expect(created.email).toBe('alice@example.com')
      expect(created.given_name).toBe('Alice')
      expect(created.vid).toBe(1)
      // Response shape hides the hash
      expect((created as Record<string, unknown>).password_hash).toBeUndefined()

      // Repository stored an argon2 hash, not the plaintext
      const row = await repo.getByEmailForSignIn('alice@example.com')
      expect(row?.password_hash).toMatch(/^\$argon2id\$/)
      expect(row?.password_hash).not.toContain('correct-horse-battery-staple')
      expect(await verifyPassword('correct-horse-battery-staple', row?.password_hash)).toBe(true)
    })

    it('lowercases the stored email', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'Alice@Example.COM',
        password: 'correct-horse-battery-staple',
      })
      expect(created.email).toBe('alice@example.com')
    })

    it('rejects a duplicate email with EMAIL_IN_USE', async () => {
      const { service } = makeService()
      await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      await expect(
        service.createUser({
          email: 'ALICE@example.com',
          password: 'another-12-chars',
        })
      ).rejects.toMatchObject({
        code: AdminUsersErrorCodes.EMAIL_IN_USE,
      })
    })
  })

  describe('getUser', () => {
    it('returns the user by id', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      const fetched = await service.getUser({ id: created.id })
      expect(fetched.id).toBe(created.id)
    })

    it('throws NOT_FOUND for an unknown id', async () => {
      const { service } = makeService()
      await expect(
        service.getUser({ id: '00000000-0000-7000-8000-000000000000' })
      ).rejects.toMatchObject({ code: AdminUsersErrorCodes.NOT_FOUND })
    })
  })

  describe('listUsers', () => {
    async function seedUsers(n: number) {
      const { service } = makeService()
      for (let i = 0; i < n; i++) {
        await service.createUser({
          email: `user${i.toString().padStart(2, '0')}@example.com`,
          password: 'correct-horse-battery-staple',
          given_name: `User${i}`,
          family_name: i % 2 === 0 ? 'Evenson' : 'Oddman',
          is_enabled: true,
        })
      }
      return service
    }

    it('returns the requested page shape with meta', async () => {
      const service = await seedUsers(7)
      const res = await service.listUsers({
        page: 1,
        pageSize: 3,
        order: 'email',
        desc: false,
      })
      expect(res.users.length).toBe(3)
      expect(res.meta).toMatchObject({
        total: 7,
        total_pages: 3,
        page: 1,
        page_size: 3,
        order: 'email',
        desc: false,
        query: '',
      })
      // email ASC sort — user00 should come first
      expect(res.users[0]?.email).toBe('user00@example.com')
    })

    it('sorts DESC when requested', async () => {
      const service = await seedUsers(5)
      const res = await service.listUsers({
        page: 1,
        pageSize: 10,
        order: 'email',
        desc: true,
      })
      expect(res.users[0]?.email).toBe('user04@example.com')
      expect(res.users[4]?.email).toBe('user00@example.com')
    })

    it('filters by query across multiple columns', async () => {
      const service = await seedUsers(6)
      const res = await service.listUsers({
        page: 1,
        pageSize: 10,
        query: 'evenson',
        order: 'email',
        desc: false,
      })
      expect(res.users.every((u) => u.family_name === 'Evenson')).toBe(true)
      expect(res.meta.total).toBe(3) // 0, 2, 4
    })

    it('returns empty users array on a page past the end', async () => {
      const service = await seedUsers(2)
      const res = await service.listUsers({
        page: 5,
        pageSize: 10,
        order: 'email',
        desc: false,
      })
      expect(res.users).toEqual([])
      expect(res.meta.total).toBe(2)
    })
  })

  describe('updateUser', () => {
    it('applies a patch, bumps vid, and returns the fresh row', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      const updated = await service.updateUser({
        id: created.id,
        vid: created.vid,
        patch: { given_name: 'Alice the Great', is_email_verified: true },
      })
      expect(updated.vid).toBe(created.vid + 1)
      expect(updated.given_name).toBe('Alice the Great')
      expect(updated.is_email_verified).toBe(true)
      expect(updated.email).toBe('alice@example.com')
    })

    it('rejects email change that collides with another user', async () => {
      const { service } = makeService()
      const alice = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      await service.createUser({
        email: 'bob@example.com',
        password: 'correct-horse-battery-staple',
      })
      await expect(
        service.updateUser({
          id: alice.id,
          vid: alice.vid,
          patch: { email: 'bob@example.com' },
        })
      ).rejects.toMatchObject({ code: AdminUsersErrorCodes.EMAIL_IN_USE })
    })

    it('allows email change back to the same address (no collision with self)', async () => {
      const { service } = makeService()
      const alice = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      const updated = await service.updateUser({
        id: alice.id,
        vid: alice.vid,
        patch: { email: 'alice@example.com', given_name: 'Alice' },
      })
      expect(updated.email).toBe('alice@example.com')
      expect(updated.given_name).toBe('Alice')
    })

    it('throws VERSION_CONFLICT on a stale vid', async () => {
      const { service } = makeService()
      const alice = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      // First update succeeds and bumps vid.
      await service.updateUser({
        id: alice.id,
        vid: alice.vid,
        patch: { given_name: 'Alice' },
      })
      // Second update using the old vid must conflict.
      await expect(
        service.updateUser({
          id: alice.id,
          vid: alice.vid,
          patch: { given_name: 'Allie' },
        })
      ).rejects.toMatchObject({ code: AdminUsersErrorCodes.VERSION_CONFLICT })
    })
  })

  describe('setPassword', () => {
    it('rehashes and stores a new hash, bumping vid', async () => {
      const { repo, service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'old-password-12',
      })
      await service.setPassword({
        id: created.id,
        vid: created.vid,
        password: 'new-password-12',
      })
      const row = await repo.getByEmailForSignIn('alice@example.com')
      expect(await verifyPassword('new-password-12', row?.password_hash)).toBe(true)
      expect(await verifyPassword('old-password-12', row?.password_hash)).toBe(false)
      const fresh = await service.getUser({ id: created.id })
      expect(fresh.vid).toBe(created.vid + 1)
    })

    it('throws VERSION_CONFLICT on a stale vid', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      await service.updateUser({
        id: created.id,
        vid: created.vid,
        patch: { given_name: 'Alice' },
      })
      await expect(
        service.setPassword({
          id: created.id,
          vid: created.vid,
          password: 'another-12-chars',
        })
      ).rejects.toMatchObject({ code: AdminUsersErrorCodes.VERSION_CONFLICT })
    })
  })

  describe('enable / disable', () => {
    it('enables a user', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
        is_enabled: false,
      })
      await service.enableUser({ id: created.id })
      const fetched = await service.getUser({ id: created.id })
      expect(fetched.is_enabled).toBe(true)
    })

    it('disables another user', async () => {
      const { service } = makeService()
      const target = await service.createUser({
        email: 'target@example.com',
        password: 'correct-horse-battery-staple',
        is_enabled: true,
      })
      const actor = makeActor('00000000-0000-7000-8000-000000000001')
      await service.disableUser(actor, { id: target.id })
      const fetched = await service.getUser({ id: target.id })
      expect(fetched.is_enabled).toBe(false)
    })

    it('refuses self-disable', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
        is_enabled: true,
      })
      const actor = makeActor(created.id)
      await expect(service.disableUser(actor, { id: created.id })).rejects.toBeInstanceOf(
        ERR_ADMIN_USER_SELF_DISABLE().constructor as new (
          ...args: unknown[]
        ) => Error
      )
    })
  })

  describe('deleteUser', () => {
    it('deletes another user', async () => {
      const { repo, service } = makeService()
      const target = await service.createUser({
        email: 'target@example.com',
        password: 'correct-horse-battery-staple',
      })
      const actor = makeActor('00000000-0000-7000-8000-000000000001')
      await service.deleteUser(actor, { id: target.id, vid: target.vid })
      expect(await repo.getById(target.id)).toBeNull()
    })

    it('refuses self-delete', async () => {
      const { service } = makeService()
      const created = await service.createUser({
        email: 'alice@example.com',
        password: 'correct-horse-battery-staple',
      })
      const actor = makeActor(created.id)
      await expect(
        service.deleteUser(actor, { id: created.id, vid: created.vid })
      ).rejects.toMatchObject({
        code: AdminUsersErrorCodes.SELF_DELETE_FORBIDDEN,
      })
    })

    it('throws NOT_FOUND for an unknown id', async () => {
      const { service } = makeService()
      const actor = makeActor('00000000-0000-7000-8000-000000000001')
      await expect(
        service.deleteUser(actor, { id: '00000000-0000-7000-8000-000000000999', vid: 1 })
      ).rejects.toMatchObject({ code: AdminUsersErrorCodes.NOT_FOUND })
    })

    it('throws VERSION_CONFLICT on a stale vid', async () => {
      const { service } = makeService()
      const target = await service.createUser({
        email: 'target@example.com',
        password: 'correct-horse-battery-staple',
      })
      const actor = makeActor('00000000-0000-7000-8000-000000000001')
      // Bump vid via an update.
      await service.updateUser({
        id: target.id,
        vid: target.vid,
        patch: { given_name: 'Target' },
      })
      await expect(
        service.deleteUser(actor, { id: target.id, vid: target.vid })
      ).rejects.toMatchObject({ code: AdminUsersErrorCodes.VERSION_CONFLICT })
    })
  })

  // The imported factories are intentionally referenced below — keeps
  // TypeScript happy about the unused-import warning and documents them
  // as part of the public error surface.
  it('exports all module-level error factories', () => {
    expect(ERR_ADMIN_USER_NOT_FOUND()).toBeInstanceOf(Error)
    expect(ERR_ADMIN_USER_EMAIL_IN_USE()).toBeInstanceOf(Error)
    expect(ERR_ADMIN_USER_SELF_DELETE()).toBeInstanceOf(Error)
    expect(ERR_ADMIN_USER_SELF_DISABLE()).toBeInstanceOf(Error)
    expect(ERR_ADMIN_USER_VERSION_CONFLICT()).toBeInstanceOf(Error)
  })
})
