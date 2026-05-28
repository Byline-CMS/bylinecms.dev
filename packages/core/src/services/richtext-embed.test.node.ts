/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Tests for the per-leaf embed walker (`embedRichTextFields`). Focus on
 * the surface owned by core — leaf gating via `embedRelationsOnSave` and
 * branch C (per-leaf error swallow). The visitor-side branches (A / B /
 * found) live in `@byline/richtext-lexical` and have their own suite.
 */

import { describe, expect, it, vi } from 'vitest'

import { embedRichTextFields } from './richtext-embed.js'
import type { FieldSet, RichTextEmbedFn } from '../@types/field-types.js'
import type { ReadContext } from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'

const noopLogger: BylineLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}

const fakeReadContext = {} as ReadContext

const richTextValue = (label: string) => ({
  root: { type: 'root', children: [], _label: label },
})

describe('embedRichTextFields', () => {
  it('invokes the embed adapter once per richText leaf, including nested ones', async () => {
    const fields: FieldSet = [
      { name: 'body', type: 'richText', label: 'Body' },
      {
        name: 'meta',
        type: 'group',
        label: 'Meta',
        fields: [{ name: 'summary', type: 'richText', label: 'Summary' }],
      },
      {
        name: 'faq',
        type: 'array',
        label: 'FAQ',
        fields: [{ name: 'answer', type: 'richText', label: 'Answer' }],
      },
    ]
    const data = {
      body: richTextValue('body'),
      meta: { summary: richTextValue('summary') },
      faq: [{ answer: richTextValue('answer-0') }],
    }

    const embed: RichTextEmbedFn = vi.fn(async () => {})
    await embedRichTextFields({
      fields,
      collectionPath: 'pages',
      data,
      embed,
      readContext: fakeReadContext,
      logger: noopLogger,
    })

    expect(embed).toHaveBeenCalledTimes(3)
    const paths = (embed as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { fieldPath: string }).fieldPath
    )
    expect(paths.sort()).toEqual(['body', 'faq.0.answer', 'meta.summary'])
  })

  it('skips leaves whose embedRelationsOnSave is explicitly false', async () => {
    const fields: FieldSet = [
      { name: 'snapshot', type: 'richText', label: 'Snapshot' },
      {
        name: 'thin',
        type: 'richText',
        label: 'Thin',
        embedRelationsOnSave: false,
      },
    ]
    const data = {
      snapshot: richTextValue('snapshot'),
      thin: richTextValue('thin'),
    }

    const embed: RichTextEmbedFn = vi.fn(async () => {})
    await embedRichTextFields({
      fields,
      collectionPath: 'pages',
      data,
      embed,
      readContext: fakeReadContext,
      logger: noopLogger,
    })

    expect(embed).toHaveBeenCalledTimes(1)
    expect((embed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      fieldPath: 'snapshot',
    })
  })

  it('swallows per-leaf errors, logs at error level, and keeps walking subsequent leaves (branch C)', async () => {
    const fields: FieldSet = [
      { name: 'first', type: 'richText', label: 'First' },
      { name: 'second', type: 'richText', label: 'Second' },
      { name: 'third', type: 'richText', label: 'Third' },
    ]
    const data = {
      first: richTextValue('first'),
      second: richTextValue('second'),
      third: richTextValue('third'),
    }

    const failingErr = new Error('transport down')
    const embed: RichTextEmbedFn = vi.fn(async (ctx) => {
      if (ctx.fieldPath === 'second') throw failingErr
    })
    const logger: BylineLogger = {
      ...noopLogger,
      error: vi.fn(),
    }

    await expect(
      embedRichTextFields({
        fields,
        collectionPath: 'pages',
        data,
        embed,
        readContext: fakeReadContext,
        logger,
      })
    ).resolves.toBeUndefined()

    // All three leaves were attempted — the failure in 'second' did not
    // short-circuit the walk.
    expect(embed).toHaveBeenCalledTimes(3)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failingErr,
        collectionPath: 'pages',
        fieldPath: 'second',
      }),
      expect.stringMatching(/branch C/i)
    )

    // The persisted state for the failing leaf is untouched (the data
    // object the caller passed in is mutated only by the adapter — and
    // here the adapter threw before doing anything).
    expect(data.second).toEqual(richTextValue('second'))
  })

  it('is a no-op when the document carries no richText fields', async () => {
    const fields: FieldSet = [{ name: 'title', type: 'text', label: 'Title' }]
    const data = { title: 'Hello' }

    const embed: RichTextEmbedFn = vi.fn(async () => {})
    await embedRichTextFields({
      fields,
      collectionPath: 'pages',
      data,
      embed,
      readContext: fakeReadContext,
      logger: noopLogger,
    })

    expect(embed).not.toHaveBeenCalled()
  })
})
