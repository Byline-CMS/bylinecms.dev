/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnyLexicalExtensionArgument } from '@lexical/extension'
import { describe, expect, it } from 'vitest'

import { ExtensionsList } from './extensions-list'

// Structural stand-ins — ExtensionsList compares by `.name`, so plain
// objects are sufficient and keep the heavy extension classes (React,
// Lexical nodes) out of this node-mode test.
const extA = { name: 'test/A' } as unknown as AnyLexicalExtensionArgument
const extB = { name: 'test/B' } as unknown as AnyLexicalExtensionArgument

describe('ExtensionsList', () => {
  it('remove() by name string drops the entry; has() reflects it', () => {
    const list = new ExtensionsList([extA, extB])
    expect(list.has('test/A')).toBe(true)
    list.remove('test/A')
    expect(list.has('test/A')).toBe(false)
    expect(list.has('test/B')).toBe(true)
  })

  it('configure() upserts — documented behaviour: absent extension is ADDED', () => {
    const list = new ExtensionsList([extB])
    // biome-ignore lint/suspicious/noExplicitAny: structural stand-in
    list.configure(extA as any, {})
    expect(list.has('test/A')).toBe(true)
  })

  it('REGRESSION: callers forwarding settings must gate configure() on has() — the clone survives a prior remove', () => {
    // Mirrors editor-context.tsx: settings forwarding used to call
    // `.configure(InlineImageExtension, …)` unconditionally, and the
    // upsert resurrected an extension the registration had deliberately
    // removed. The gated pattern must leave the removal intact.
    const list = new ExtensionsList([extA, extB])
    list.remove('test/A')

    const configured = list.clone()
    if (configured.has('test/A')) {
      // biome-ignore lint/suspicious/noExplicitAny: structural stand-in
      configured.configure(extA as any, {})
    }

    expect(configured.has('test/A')).toBe(false)
    expect(configured.toArray().length).toBe(1)
  })

  it('clone() is independent — mutations do not leak back', () => {
    const list = new ExtensionsList([extA, extB])
    const copy = list.clone()
    copy.remove('test/B')
    expect(list.has('test/B')).toBe(true)
    expect(copy.has('test/B')).toBe(false)
  })
})
