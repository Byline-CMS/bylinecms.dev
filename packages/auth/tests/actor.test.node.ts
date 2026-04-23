/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { AdminAuth, isAdminAuth, isUserAuth, UserAuth } from '../src/actor.js'
import { AuthError, AuthErrorCodes } from '../src/errors.js'

describe('AdminAuth', () => {
  describe('hasAbility', () => {
    it('returns true when the ability is in the set', () => {
      const admin = new AdminAuth({
        id: 'admin-1',
        abilities: ['collections.pages.read', 'collections.pages.update'],
      })
      expect(admin.hasAbility('collections.pages.read')).toBe(true)
      expect(admin.hasAbility('collections.pages.update')).toBe(true)
    })

    it('returns false when the ability is missing', () => {
      const admin = new AdminAuth({
        id: 'admin-1',
        abilities: ['collections.pages.read'],
      })
      expect(admin.hasAbility('collections.pages.publish')).toBe(false)
    })

    it('returns false when the ability set is empty', () => {
      const admin = new AdminAuth({ id: 'admin-1', abilities: [] })
      expect(admin.hasAbility('any.ability')).toBe(false)
    })

    it('returns true for any ability when isSuperAdmin is set', () => {
      const admin = new AdminAuth({
        id: 'root',
        abilities: [],
        isSuperAdmin: true,
      })
      expect(admin.hasAbility('collections.pages.delete')).toBe(true)
      expect(admin.hasAbility('totally.unregistered.ability')).toBe(true)
    })
  })

  describe('assertAbility', () => {
    it('returns silently when the ability is held', () => {
      const admin = new AdminAuth({
        id: 'admin-1',
        abilities: ['collections.pages.publish'],
      })
      expect(() => admin.assertAbility('collections.pages.publish')).not.toThrow()
    })

    it('throws ERR_FORBIDDEN with a default message when the ability is missing', () => {
      const admin = new AdminAuth({ id: 'admin-1', abilities: [] })
      try {
        admin.assertAbility('collections.pages.publish')
        expect.fail('expected assertAbility to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.pages.publish')
      }
    })

    it('throws ERR_FORBIDDEN with a custom message when one is provided', () => {
      const admin = new AdminAuth({ id: 'admin-1', abilities: [] })
      expect(() => admin.assertAbility('collections.pages.publish', 'nope')).toThrow(/nope/)
    })

    it('does not throw for super-admins even when the ability is missing', () => {
      const admin = new AdminAuth({
        id: 'root',
        abilities: [],
        isSuperAdmin: true,
      })
      expect(() => admin.assertAbility('anything.at.all')).not.toThrow()
    })
  })

  describe('assertAbilities', () => {
    it('returns silently when every ability is held', () => {
      const admin = new AdminAuth({
        id: 'admin-1',
        abilities: ['a.read', 'a.write'],
      })
      expect(() => admin.assertAbilities(['a.read', 'a.write'])).not.toThrow()
    })

    it('throws on the first missing ability', () => {
      const admin = new AdminAuth({
        id: 'admin-1',
        abilities: ['a.read'],
      })
      try {
        admin.assertAbilities(['a.read', 'a.write', 'a.delete'])
        expect.fail('expected assertAbilities to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect((err as AuthError).message).toContain('a.write')
      }
    })

    it('uses a per-ability message when provided', () => {
      const admin = new AdminAuth({ id: 'admin-1', abilities: [] })
      expect(() => admin.assertAbilities(['a.read'], (a) => `custom: ${a}`)).toThrow(
        /custom: a\.read/
      )
    })

    it('bypasses every check for super-admins', () => {
      const admin = new AdminAuth({
        id: 'root',
        abilities: [],
        isSuperAdmin: true,
      })
      expect(() => admin.assertAbilities(['any.a', 'any.b', 'any.c'])).not.toThrow()
    })
  })

  describe('construction', () => {
    it('defaults isSuperAdmin to false', () => {
      const admin = new AdminAuth({ id: 'x', abilities: [] })
      expect(admin.isSuperAdmin).toBe(false)
    })

    it('stores abilities as a Set (deduplicating input)', () => {
      const admin = new AdminAuth({
        id: 'x',
        abilities: ['a.read', 'a.read', 'a.write'],
      })
      expect(admin.abilities.size).toBe(2)
    })
  })
})

describe('UserAuth', () => {
  it('holds abilities and answers hasAbility', () => {
    const user = new UserAuth({ id: 'user-1', abilities: ['articles.read'] })
    expect(user.hasAbility('articles.read')).toBe(true)
    expect(user.hasAbility('articles.write')).toBe(false)
  })

  it('assertAbility throws ERR_FORBIDDEN on missing ability', () => {
    const user = new UserAuth({ id: 'user-1' })
    expect(() => user.assertAbility('articles.read')).toThrow(AuthError)
  })
})

describe('isAdminAuth / isUserAuth', () => {
  it('discriminates between realms', () => {
    const admin = new AdminAuth({ id: 'a', abilities: [] })
    const user = new UserAuth({ id: 'u' })
    expect(isAdminAuth(admin)).toBe(true)
    expect(isAdminAuth(user)).toBe(false)
    expect(isAdminAuth(null)).toBe(false)
    expect(isUserAuth(user)).toBe(true)
    expect(isUserAuth(admin)).toBe(false)
    expect(isUserAuth(null)).toBe(false)
  })
})
