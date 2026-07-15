/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth, createRequestContext } from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import {
  type BeforeReadHookFn,
  type CollectionDefinition,
  defineCollection,
  defineWorkflow,
} from '../@types/collection-types.js'
import { createReadContext } from '../services/populate.js'
import { applyBeforeRead, compileBeforeReadFilters } from './apply-before-read.js'
import { resolveReadContextRoot } from './read-context-scope.js'

const baseCollection = (hook?: BeforeReadHookFn | BeforeReadHookFn[]): CollectionDefinition =>
  defineCollection({
    path: 'posts',
    labels: { singular: 'Post', plural: 'Posts' },
    workflow: defineWorkflow({
      draft: { label: 'Draft', verb: 'Revert to Draft' },
      published: { label: 'Published', verb: 'Publish' },
    }),
    fields: [{ name: 'title', type: 'text', label: 'Title' }],
    ...(hook ? { hooks: { beforeRead: hook } } : {}),
  })

describe('applyBeforeRead', () => {
  it('returns null when the collection has no beforeRead hook', async () => {
    const result = await applyBeforeRead({
      definition: baseCollection(),
      requestContext: createRequestContext(),
      readContext: createReadContext(),
    })
    expect(result).toBeNull()
  })

  it('returns the predicate from a single hook', async () => {
    const hook: BeforeReadHookFn = () => ({ status: 'published' })
    const result = await applyBeforeRead({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext: createReadContext(),
    })
    expect(result).toEqual({ status: 'published' })
  })

  it('returns null when the hook returns void', async () => {
    const hook: BeforeReadHookFn = () => undefined
    const result = await applyBeforeRead({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext: createReadContext(),
    })
    expect(result).toBeNull()
  })

  it('combines multiple hook predicates with implicit AND', async () => {
    const a: BeforeReadHookFn = () => ({ tenantId: 't-1' })
    const b: BeforeReadHookFn = () => ({ status: 'published' })
    const result = await applyBeforeRead({
      definition: baseCollection([a, b]),
      requestContext: createRequestContext(),
      readContext: createReadContext(),
    })
    expect(result).toEqual({
      $and: [{ tenantId: 't-1' }, { status: 'published' }],
    })
  })

  it('skips void-returning hooks when combining', async () => {
    const a: BeforeReadHookFn = () => ({ tenantId: 't-1' })
    const b: BeforeReadHookFn = () => undefined
    const c: BeforeReadHookFn = () => ({ status: 'published' })
    const result = await applyBeforeRead({
      definition: baseCollection([a, b, c]),
      requestContext: createRequestContext(),
      readContext: createReadContext(),
    })
    expect(result).toEqual({
      $and: [{ tenantId: 't-1' }, { status: 'published' }],
    })
  })

  it('caches the predicate on ReadContext (hook runs once per request)', async () => {
    let callCount = 0
    const hook: BeforeReadHookFn = () => {
      callCount += 1
      return { tenantId: 't-1' }
    }
    const def = baseCollection(hook)
    const readContext = createReadContext()
    const requestContext = createRequestContext()

    await applyBeforeRead({ definition: def, requestContext, readContext })
    await applyBeforeRead({ definition: def, requestContext, readContext })
    await applyBeforeRead({ definition: def, requestContext, readContext })
    expect(callCount).toBe(1)
  })

  it('caches a void result so subsequent calls do not re-run the hook', async () => {
    let callCount = 0
    const hook: BeforeReadHookFn = () => {
      callCount += 1
      return undefined
    }
    const def = baseCollection(hook)
    const readContext = createReadContext()
    const requestContext = createRequestContext()

    const first = await applyBeforeRead({ definition: def, requestContext, readContext })
    const second = await applyBeforeRead({ definition: def, requestContext, readContext })
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(callCount).toBe(1)
  })

  it('ignores a caller-preseeded public cache entry', async () => {
    const hook = vi.fn(() => ({ title: 'allowed' }))
    const readContext = createReadContext({
      beforeReadCache: new Map([['posts:any', null]]),
    })

    const result = await applyBeforeRead({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext,
    })

    expect(hook).toHaveBeenCalledOnce()
    expect(result).toEqual({ title: 'allowed' })
  })

  it('ignores a caller-preseeded public cache entry on the compiled-filter path', async () => {
    const hook = vi.fn(() => ({ title: 'allowed' }))
    const readContext = createReadContext({
      beforeReadCache: new Map([['posts:any', null]]),
    })

    const filters = await compileBeforeReadFilters({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext,
      securityDomain: {},
      parseContext: { collections: [], resolveCollectionId: vi.fn() },
    })

    expect(hook).toHaveBeenCalledOnce()
    expect(filters).toEqual([
      expect.objectContaining({ kind: 'field', fieldName: 'title', value: 'allowed' }),
    ])
  })

  it('rejects reuse under a different actor authority', async () => {
    const hook = vi.fn(({ requestContext }: Parameters<BeforeReadHookFn>[0]) => ({
      title: requestContext.actor?.id,
    }))
    const definition = baseCollection(hook)
    const readContext = createReadContext()
    const requestId = 'same-logical-request'
    const alice = createRequestContext({
      actor: new AdminAuth({ id: 'alice', abilities: ['collections.posts.read'] }),
      requestId,
    })
    const bob = createRequestContext({
      actor: new AdminAuth({ id: 'bob', abilities: ['collections.posts.read'] }),
      requestId,
    })

    await applyBeforeRead({ definition, requestContext: alice, readContext })
    await expect(applyBeforeRead({ definition, requestContext: bob, readContext })).rejects.toThrow(
      'cannot be reused across request authorities'
    )
    expect(hook).toHaveBeenCalledOnce()
  })

  it('runs the hook again on a fresh ReadContext', async () => {
    let callCount = 0
    const hook: BeforeReadHookFn = () => {
      callCount += 1
      return { tenantId: 't-1' }
    }
    const def = baseCollection(hook)
    const requestContext = createRequestContext()

    await applyBeforeRead({ definition: def, requestContext, readContext: createReadContext() })
    await applyBeforeRead({ definition: def, requestContext, readContext: createReadContext() })
    expect(callCount).toBe(2)
  })

  it('caches independently by effective read mode', async () => {
    const modes: Array<string | undefined> = []
    const hook: BeforeReadHookFn = ({ requestContext }) => {
      modes.push(requestContext.readMode)
      return { status: requestContext.readMode === 'published' ? 'published' : 'draft' }
    }
    const definition = baseCollection(hook)
    const readContext = createReadContext()
    const base = createRequestContext()

    await applyBeforeRead({
      definition,
      requestContext: { ...base, readMode: 'published' },
      readContext,
    })
    await applyBeforeRead({
      definition,
      requestContext: { ...base, readMode: 'any' },
      readContext,
    })
    await applyBeforeRead({
      definition,
      requestContext: { ...base, readMode: 'published' },
      readContext,
    })

    expect(modes).toEqual(['published', 'any'])
  })

  it('passes collectionPath, requestContext, and readContext through to the hook', async () => {
    let received: unknown
    const hook: BeforeReadHookFn = (ctx) => {
      received = ctx
    }
    const def = baseCollection(hook)
    const requestContext = createRequestContext()
    const readContext = createReadContext()
    await applyBeforeRead({ definition: def, requestContext, readContext })
    expect(received).toMatchObject({
      collectionPath: 'posts',
      requestContext,
    })
    expect((received as Parameters<BeforeReadHookFn>[0]).readContext.visited).toBe(
      readContext.visited
    )
  })

  it('delegates scoped read-budget state to the logical root context', async () => {
    const readContext = createReadContext({ maxReads: 4 })
    const hook: BeforeReadHookFn = ({ readContext: scoped }) => {
      scoped.visited.add('posts:nested')
      scoped.readCount += 1
      scoped.maxReads = 3
    }

    await applyBeforeRead({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext,
    })

    expect(readContext.visited).toContain('posts:nested')
    expect(readContext.readCount).toBe(1)
    expect(readContext.maxReads).toBe(3)
  })

  it('resolves scoped hook contexts to their logical root', async () => {
    const readContext = createReadContext()
    let scopedContext: Parameters<BeforeReadHookFn>[0]['readContext'] | undefined
    const hook: BeforeReadHookFn = ({ readContext: scoped }) => {
      scopedContext = scoped
    }

    await applyBeforeRead({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext,
    })

    if (!scopedContext) throw new Error('beforeRead did not receive a scoped ReadContext')
    expect(resolveReadContextRoot(scopedContext)).toBe(readContext)
    expect(resolveReadContextRoot(readContext)).toBe(readContext)
  })

  it('supports an async hook', async () => {
    const hook: BeforeReadHookFn = async () => {
      await Promise.resolve()
      return { tenantId: 't-1' }
    }
    const result = await applyBeforeRead({
      definition: baseCollection(hook),
      requestContext: createRequestContext(),
      readContext: createReadContext(),
    })
    expect(result).toEqual({ tenantId: 't-1' })
  })

  it('compiles security filters and resolves relation collection ids once per read context', async () => {
    const categories = defineCollection({
      path: 'categories',
      labels: { singular: 'Category', plural: 'Categories' },
      fields: [{ name: 'tenant', type: 'text', label: 'Tenant' }],
    })
    const definition = defineCollection({
      path: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      fields: [
        {
          name: 'category',
          type: 'relation',
          label: 'Category',
          targetCollection: 'categories',
        },
      ],
      hooks: { beforeRead: () => ({ category: { tenant: 'alice' } }) },
    })
    const readContext = createReadContext()
    const requestContext = createRequestContext({ readMode: 'published' })
    const resolveCollectionId = vi.fn(async () => 'categories-id')
    const params = {
      definition,
      requestContext,
      readContext,
      securityDomain: {},
      parseContext: { collections: [definition, categories], resolveCollectionId },
    }

    const [first, second] = await Promise.all([
      compileBeforeReadFilters(params),
      compileBeforeReadFilters(params),
    ])

    expect(second).toBe(first)
    expect(resolveCollectionId).toHaveBeenCalledOnce()
  })

  it('compiles the same definition independently for different security domains', async () => {
    const categories = defineCollection({
      path: 'categories',
      labels: { singular: 'Category', plural: 'Categories' },
      fields: [{ name: 'tenant', type: 'text', label: 'Tenant' }],
    })
    const hook = vi.fn(() => ({ category: { tenant: 'alice' } }))
    const definition = defineCollection({
      path: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      fields: [
        {
          name: 'category',
          type: 'relation',
          label: 'Category',
          targetCollection: 'categories',
        },
      ],
      hooks: { beforeRead: hook },
    })
    const readContext = createReadContext()
    const requestContext = createRequestContext({ readMode: 'published' })
    const resolveA = vi.fn(async () => 'categories-a')
    const resolveB = vi.fn(async () => 'categories-b')

    await compileBeforeReadFilters({
      definition,
      requestContext,
      readContext,
      securityDomain: {},
      parseContext: { collections: [definition, categories], resolveCollectionId: resolveA },
    })
    await compileBeforeReadFilters({
      definition,
      requestContext,
      readContext,
      securityDomain: {},
      parseContext: { collections: [definition, categories], resolveCollectionId: resolveB },
    })

    expect(hook).toHaveBeenCalledTimes(2)
    expect(resolveA).toHaveBeenCalledOnce()
    expect(resolveB).toHaveBeenCalledOnce()
  })

  it('fails closed on a recursive beforeRead for the same collection', async () => {
    const readContext = createReadContext()
    const requestContext = createRequestContext()
    let definition: CollectionDefinition
    const hook: BeforeReadHookFn = async (ctx) => {
      await applyBeforeRead({
        definition,
        requestContext: ctx.requestContext,
        readContext: ctx.readContext,
      })
    }
    definition = baseCollection(hook)

    await expect(
      applyBeforeRead({ definition, requestContext, readContext })
    ).rejects.toMatchObject({ code: 'ERR_READ_RECURSION' })
  })

  it('fails closed on an A to B to A beforeRead cycle', async () => {
    const readContext = createReadContext()
    const requestContext = createRequestContext()
    const securityDomain = {}
    let a: CollectionDefinition
    let b: CollectionDefinition
    a = defineCollection({
      path: 'a',
      labels: { singular: 'A', plural: 'As' },
      fields: [{ name: 'title', type: 'text', label: 'Title' }],
      hooks: {
        beforeRead: async (ctx) => {
          await applyBeforeRead({
            definition: b,
            requestContext: ctx.requestContext,
            readContext: ctx.readContext,
            securityDomain,
          })
        },
      },
    })
    b = defineCollection({
      path: 'b',
      labels: { singular: 'B', plural: 'Bs' },
      fields: [{ name: 'title', type: 'text', label: 'Title' }],
      hooks: {
        beforeRead: async (ctx) => {
          await applyBeforeRead({
            definition: a,
            requestContext: ctx.requestContext,
            readContext: ctx.readContext,
            securityDomain,
          })
        },
      },
    })

    await expect(
      applyBeforeRead({ definition: a, requestContext, readContext, securityDomain })
    ).rejects.toMatchObject({ code: 'ERR_READ_RECURSION' })
  })
})
