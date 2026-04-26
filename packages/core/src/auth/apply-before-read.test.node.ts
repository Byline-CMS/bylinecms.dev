/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createRequestContext } from '@byline/auth'
import { describe, expect, it } from 'vitest'

import {
  type BeforeReadHookFn,
  type CollectionDefinition,
  defineCollection,
  defineWorkflow,
} from '../@types/collection-types.js'
import { createReadContext } from '../services/populate.js'
import { applyBeforeRead } from './apply-before-read.js'

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
      readContext,
    })
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
})
