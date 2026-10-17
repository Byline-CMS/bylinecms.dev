/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BlocksField, BylineLogger, MultiCollectionDefinition } from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { setupTestClient, type TestContext, teardownTestClient } from '../fixtures/setup.js'

const live = {
  blockType: 'live',
  fields: [{ name: 'text', type: 'text' as const, localized: true }],
}
const retired = { ...live, blockType: 'retired' }
const content: BlocksField = { name: 'content', type: 'blocks', blocks: [live, retired] }
const definition: MultiCollectionDefinition = {
  path: 'sdk-unavailable',
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [content],
}
let ctx: TestContext
const loggerKey = Symbol.for('__byline_logger__')
const globals = globalThis as Record<symbol, unknown>
const priorLogger = globals[loggerKey]
beforeAll(async () => {
  defineLogger(
    Object.fromEntries(
      ['log', 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((key) => [
        key,
        vi.fn(),
      ])
    ) as unknown as BylineLogger
  )
  ctx = await setupTestClient(definition)
})
afterAll(async () => {
  if (ctx) await teardownTestClient(ctx)
  if (priorLogger === undefined) delete globals[loggerKey]
  else globals[loggerKey] = priorLogger
})
it('exposes metadata on SDK reads and drops unavailable blocks on whole-document update', async () => {
  const handle = ctx.client.collection(definition.path)
  const created = await handle.create({
    content: [
      { _type: 'retired', text: 'old' },
      { _type: 'live', text: 'keep' },
    ],
  })
  content.blocks = [live]
  const read = await handle.findById(created.documentId, { status: 'any', locale: 'en' })
  expect(read?._unavailableBlocks).toEqual([
    expect.objectContaining({
      fieldPath: 'content',
      storedIndex: 0,
      blockType: 'retired',
      id: expect.any(String),
    }),
  ])
  expect(read?._restoreWarnings).toBeUndefined()
  const lenient = await handle.findById(created.documentId, {
    status: 'any',
    locale: 'en',
    lenient: true,
  })
  expect(lenient?._unavailableBlocks).toEqual(read?._unavailableBlocks)
  await handle.update(created.documentId, read!.fields, {
    expectedRevision: created.revision,
    locale: 'en',
  })
  content.blocks = [live, retired]
  const saved = await handle.findById(created.documentId, { status: 'any', locale: 'en' })
  expect(saved?._unavailableBlocks).toBeUndefined()
  expect(saved?.fields.content).toEqual([expect.objectContaining({ _type: 'live', text: 'keep' })])
})
