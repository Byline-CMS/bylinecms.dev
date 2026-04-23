/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { AdminAuth, isAdminAuth } from '../src/actor.js'
import { createRequestContext, createSuperAdminContext } from '../src/context.js'

describe('createRequestContext', () => {
  it('defaults actor to null and mints a UUIDv7 request id', () => {
    const ctx = createRequestContext()
    expect(ctx.actor).toBeNull()
    expect(ctx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
  })

  it('honours provided overrides', () => {
    const admin = new AdminAuth({ id: 'a', abilities: ['a.read'] })
    const ctx = createRequestContext({
      actor: admin,
      requestId: 'fixed-id',
      locale: 'en',
      readMode: 'published',
    })
    expect(ctx.actor).toBe(admin)
    expect(ctx.requestId).toBe('fixed-id')
    expect(ctx.locale).toBe('en')
    expect(ctx.readMode).toBe('published')
  })
})

describe('createSuperAdminContext', () => {
  it('produces a context with a super-admin AdminAuth actor', () => {
    const ctx = createSuperAdminContext()
    expect(isAdminAuth(ctx.actor)).toBe(true)
    const admin = ctx.actor as AdminAuth
    expect(admin.isSuperAdmin).toBe(true)
    expect(admin.id).toBe('super-admin')
  })

  it('super-admin actor bypasses assertAbility', () => {
    const ctx = createSuperAdminContext({ id: 'seed-runner' })
    const admin = ctx.actor as AdminAuth
    expect(admin.id).toBe('seed-runner')
    expect(() => admin.assertAbility('anything.at.all')).not.toThrow()
  })

  it('mints a UUIDv7 request id by default and honours explicit ids', () => {
    const ctx1 = createSuperAdminContext()
    expect(ctx1.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    const ctx2 = createSuperAdminContext({ requestId: 'fixed' })
    expect(ctx2.requestId).toBe('fixed')
  })
})
