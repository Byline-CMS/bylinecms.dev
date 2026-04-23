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
} from '@byline/auth'
import { describe, expect, it } from 'vitest'

import { assertActorCanPerform } from './assert-actor-can-perform.js'

describe('assertActorCanPerform', () => {
  describe('missing context', () => {
    it('throws ERR_UNAUTHENTICATED when context is undefined', () => {
      try {
        assertActorCanPerform(undefined, 'pages', 'read')
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
    })
  })

  describe('null actor (anonymous)', () => {
    it('permits read with readMode: published', () => {
      const ctx = createRequestContext({ actor: null, readMode: 'published' })
      expect(() => assertActorCanPerform(ctx, 'pages', 'read')).not.toThrow()
    })

    it('rejects read with readMode: any', () => {
      const ctx = createRequestContext({ actor: null, readMode: 'any' })
      try {
        assertActorCanPerform(ctx, 'pages', 'read')
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
        expect((err as AuthError).message).toMatch(/readMode.*published/)
      }
    })

    it('rejects read when readMode is unset', () => {
      const ctx = createRequestContext({ actor: null })
      try {
        assertActorCanPerform(ctx, 'pages', 'read')
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
    })

    it('rejects every non-read verb regardless of readMode', () => {
      const ctx = createRequestContext({ actor: null, readMode: 'published' })
      for (const verb of ['create', 'update', 'delete', 'publish', 'changeStatus'] as const) {
        try {
          assertActorCanPerform(ctx, 'pages', verb)
          expect.fail(`expected ERR_UNAUTHENTICATED for ${verb}`)
        } catch (err) {
          expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
        }
      }
    })
  })

  describe('actor with abilities', () => {
    it('permits the verb when the specific ability is held', () => {
      const actor = new AdminAuth({
        id: 'editor-1',
        abilities: ['collections.pages.update'],
      })
      const ctx = createRequestContext({ actor })
      expect(() => assertActorCanPerform(ctx, 'pages', 'update')).not.toThrow()
    })

    it('throws ERR_FORBIDDEN when the specific ability is missing', () => {
      const actor = new AdminAuth({
        id: 'editor-1',
        abilities: ['collections.pages.read'],
      })
      const ctx = createRequestContext({ actor })
      try {
        assertActorCanPerform(ctx, 'pages', 'publish')
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.pages.publish')
      }
    })

    it('checks the ability against the specific collectionPath', () => {
      const actor = new AdminAuth({
        id: 'editor-1',
        abilities: ['collections.pages.update'], // has update for 'pages' only
      })
      const ctx = createRequestContext({ actor })
      expect(() => assertActorCanPerform(ctx, 'pages', 'update')).not.toThrow()
      try {
        assertActorCanPerform(ctx, 'news', 'update')
        expect.fail('expected ERR_FORBIDDEN — wrong collection')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.news.update')
      }
    })
  })

  describe('super-admin', () => {
    it('passes every verb on every collection without explicit abilities', () => {
      const ctx = createSuperAdminContext()
      const verbs = ['read', 'create', 'update', 'delete', 'publish', 'changeStatus'] as const
      for (const verb of verbs) {
        expect(() => assertActorCanPerform(ctx, 'any-collection', verb)).not.toThrow()
      }
    })

    it('passes even when readMode would normally reject a null actor', () => {
      // Super-admin doesn't care about readMode at this layer.
      const ctx = createSuperAdminContext()
      expect(() => assertActorCanPerform(ctx, 'pages', 'read')).not.toThrow()
    })
  })
})
