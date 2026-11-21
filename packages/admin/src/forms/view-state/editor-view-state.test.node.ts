/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { createEditorViewStateStore } from './editor-view-state'

const target = { path: 'title', role: 'field', offset: 120 } as const

describe('editor view state store', () => {
  it('tabs and collapse round-trip', () => {
    const s = createEditorViewStateStore()
    s.setTab('main', 'content')
    expect(s.getTab('main')).toBe('content')
    s.setCollapsed('content[id=a]', true)
    expect(s.isCollapsed('content[id=a]')).toBe(true)
    s.setCollapsed('content[id=a]', false)
    expect(s.isCollapsed('content[id=a]')).toBe(false)
  })

  it('collapse under a positional address is ignored', () => {
    const s = createEditorViewStateStore()
    s.setCollapsed('content[1]', true)
    expect(s.isCollapsed('content[1]')).toBe(false)
  })

  it('a refused save leaves nothing pending', () => {
    const s = createEditorViewStateStore()
    const n = s.beginSave()
    s.settleSave(n, 'refused')
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('a successful save yields one restoration', () => {
    const s = createEditorViewStateStore()
    s.setTarget({ ...target })
    const n = s.beginSave()
    s.setTarget({ path: 'other', role: 'field', offset: 1 })
    s.settleSave(n, 'success')
    expect(s.takePendingRestore(undefined)).toEqual({
      saveSeq: n,
      target,
      focusWarning: false,
      expectedRevision: null,
    })
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('a warning belongs to its own save', () => {
    const s = createEditorViewStateStore()
    const a = s.beginSave()
    s.markSaveWarning()
    s.settleSave(a, 'success')
    expect(s.takePendingRestore(undefined)?.focusWarning).toBe(true)
    const b = s.beginSave()
    s.settleSave(b, 'success')
    expect(s.takePendingRestore(undefined)?.focusWarning).toBe(false)
  })

  it('cancelling discards a pending restoration', () => {
    const s = createEditorViewStateStore()
    s.settleSave(s.beginSave(), 'success')
    s.cancelPendingRestore()
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('restoration waits for the expected revision', () => {
    const s = createEditorViewStateStore()
    const n = s.beginSave()
    s.expectRefresh({ revision: 47 })
    s.settleSave(n, 'success')
    expect(s.takePendingRestore(46)).toBeNull()
    expect(s.takePendingRestore(undefined)).toBeNull()
    expect(s.takePendingRestore(47)?.expectedRevision).toBe(47)
    expect(s.takePendingRestore(47)).toBeNull()
  })

  it('no receipt means no revision gate', () => {
    const s = createEditorViewStateStore()
    s.settleSave(s.beginSave(), 'success')
    expect(s.takePendingRestore(undefined)?.expectedRevision).toBeNull()
  })

  it('a newer save supersedes a pending restoration', () => {
    const s = createEditorViewStateStore()
    const a = s.beginSave()
    const b = s.beginSave()
    s.settleSave(a, 'success')
    expect(s.takePendingRestore(undefined)).toBeNull()
    s.settleSave(b, 'success')
    expect(s.takePendingRestore(undefined)?.saveSeq).toBe(b)
  })

  it('collapse under an empty address is ignored', () => {
    const s = createEditorViewStateStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.setCollapsed('', true)
    expect(s.isCollapsed('')).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('settling a save notifies a subscriber that can then consume once', () => {
    const s = createEditorViewStateStore()
    const n = s.beginSave()
    const seen: Array<ReturnType<typeof s.takePendingRestore>> = []
    s.subscribe(() => seen.push(s.takePendingRestore(undefined)))
    s.settleSave(n, 'success')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.saveSeq).toBe(n)
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('a refused save does not notify', () => {
    const s = createEditorViewStateStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.settleSave(s.beginSave(), 'refused')
    expect(listener).not.toHaveBeenCalled()
  })

  it('subscribe notifies on writes', () => {
    const s = createEditorViewStateStore()
    const listener = vi.fn()
    const off = s.subscribe(listener)
    s.setTab('main', 'x')
    s.setCollapsed('a[id=1]', true)
    s.setTarget({ ...target })
    expect(listener).toHaveBeenCalledTimes(3)
    off()
    s.setTab('main', 'y')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
