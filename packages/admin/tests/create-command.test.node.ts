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
  UserAuth,
} from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'
import { ZodError, z } from 'zod'

import { createCommand } from '../src/lib/create-command.js'

type NoDeps = {}
const noDeps: NoDeps = {}

const echoSchema = z.object({ value: z.string() })
const echoResponseSchema = z.object({ value: z.string(), actorId: z.string() })

function contextWith(
  abilities: string[],
  id = '00000000-0000-7000-8000-000000000001'
): RequestContext {
  return createRequestContext({
    actor: new AdminAuth({ id, abilities, isSuperAdmin: false }),
  })
}

describe('createCommand', () => {
  describe('input validation', () => {
    it('parses input through the input schema and rejects invalid shapes', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      const ctx = createSuperAdminContext()
      await expect(cmd(ctx, { value: 42 }, noDeps)).rejects.toBeInstanceOf(ZodError)
    })

    it('coerces null / undefined input to {} before parsing', async () => {
      const cmd = createCommand({
        method: 'list',
        auth: { ability: 'demo.read' },
        schemas: {
          input: z.object({ page: z.number().int().min(1).optional().default(1) }),
          output: z.object({ page: z.number() }),
        },
        handler: ({ input }) => ({ page: input.page }),
      })

      const ctx = createSuperAdminContext()
      const response = await cmd(ctx, undefined, noDeps)
      expect(response.page).toBe(1)
    })
  })

  describe('auth: { ability }', () => {
    it('rejects missing context with ERR_UNAUTHENTICATED', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      await expect(cmd(undefined, { value: 'hi' }, noDeps)).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
    })

    it('rejects anonymous (null actor) with ERR_UNAUTHENTICATED', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      const ctx = createRequestContext({ actor: null })
      await expect(cmd(ctx, { value: 'hi' }, noDeps)).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
    })

    it('rejects a non-admin actor (UserAuth) with ERR_UNAUTHENTICATED', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      const ctx = createRequestContext({
        actor: new UserAuth({ id: '00000000-0000-7000-8000-000000000777', abilities: [] }),
      })
      await expect(cmd(ctx, { value: 'hi' }, noDeps)).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
    })

    it('rejects an admin actor missing the ability with ERR_FORBIDDEN', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      const ctx = contextWith([]) // no abilities, not super-admin
      await expect(cmd(ctx, { value: 'hi' }, noDeps)).rejects.toMatchObject({
        code: AuthErrorCodes.FORBIDDEN,
      })
    })

    it('accepts an admin actor holding the named ability', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      const actorId = '00000000-0000-7000-8000-0000000000aa'
      const ctx = contextWith(['demo.echo'], actorId)
      const response = await cmd(ctx, { value: 'hello' }, noDeps)
      expect(response).toEqual({ value: 'hello', actorId })
    })

    it('super-admin bypasses ability check', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.never-granted' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      const ctx = createSuperAdminContext({ id: '00000000-0000-7000-8000-000000000bbb' })
      const response = await cmd(ctx, { value: 'sudo' }, noDeps)
      expect(response.value).toBe('sudo')
    })

    it('wraps auth failures in AuthError', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: { input: echoSchema, output: echoResponseSchema },
        handler: ({ input, actor }) => ({ value: input.value, actorId: actor.id }),
      })

      try {
        await cmd(undefined, { value: 'hi' }, noDeps)
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
      }
    })
  })

  describe('auth: { authenticated: true }', () => {
    it('rejects missing context with ERR_UNAUTHENTICATED', async () => {
      const cmd = createCommand({
        method: 'whoami',
        auth: { authenticated: true },
        schemas: {
          input: z.object({}).strict(),
          output: z.object({ actorId: z.string() }),
        },
        handler: ({ actor }) => ({ actorId: actor.id }),
      })

      await expect(cmd(undefined, {}, noDeps)).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
    })

    it('accepts any admin actor regardless of abilities', async () => {
      const cmd = createCommand({
        method: 'whoami',
        auth: { authenticated: true },
        schemas: {
          input: z.object({}).strict(),
          output: z.object({ actorId: z.string() }),
        },
        handler: ({ actor }) => ({ actorId: actor.id }),
      })

      const actorId = '00000000-0000-7000-8000-0000000000cc'
      const ctx = contextWith([], actorId) // no abilities
      const response = await cmd(ctx, {}, noDeps)
      expect(response.actorId).toBe(actorId)
    })

    it('rejects a non-admin actor (UserAuth) with ERR_UNAUTHENTICATED', async () => {
      const cmd = createCommand({
        method: 'whoami',
        auth: { authenticated: true },
        schemas: {
          input: z.object({}).strict(),
          output: z.object({ actorId: z.string() }),
        },
        handler: ({ actor }) => ({ actorId: actor.id }),
      })

      const ctx = createRequestContext({
        actor: new UserAuth({ id: '00000000-0000-7000-8000-000000000888', abilities: [] }),
      })
      await expect(cmd(ctx, {}, noDeps)).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
    })
  })

  describe('handler args', () => {
    it('passes context, input, deps, and the narrowed admin actor', async () => {
      interface Deps {
        marker: string
      }
      const handler = vi.fn(({ input, deps, actor }) => ({
        echo: input.value,
        actorId: actor.id,
        marker: deps.marker,
      }))
      const cmd = createCommand<
        { value: string },
        { echo: string; actorId: string; marker: string },
        Deps
      >({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: {
          input: echoSchema,
          output: z.object({ echo: z.string(), actorId: z.string(), marker: z.string() }),
        },
        handler,
      })

      const actorId = '00000000-0000-7000-8000-0000000000dd'
      const ctx = contextWith(['demo.echo'], actorId)
      const deps: Deps = { marker: 'tony' }
      const response = await cmd(ctx, { value: 'hello' }, deps)

      expect(response).toEqual({ echo: 'hello', actorId, marker: 'tony' })
      expect(handler).toHaveBeenCalledTimes(1)
      const args = handler.mock.calls[0][0]
      expect(args.context).toBe(ctx)
      expect(args.deps).toBe(deps)
      expect(args.input).toEqual({ value: 'hello' })
      expect(args.actor.id).toBe(actorId)
    })
  })

  describe('output validation', () => {
    it('parses handler return through the output schema', async () => {
      const cmd = createCommand({
        method: 'echo',
        auth: { ability: 'demo.echo' },
        schemas: {
          input: echoSchema,
          output: z.object({ value: z.string() }).strict(),
        },
        // Cast so we can return an extra key the strict schema will reject.
        handler: ({ input }) =>
          ({ value: input.value, stray: 'leak' }) as unknown as { value: string },
      })

      const ctx = createSuperAdminContext()
      await expect(cmd(ctx, { value: 'hi' }, noDeps)).rejects.toBeInstanceOf(ZodError)
    })
  })
})
