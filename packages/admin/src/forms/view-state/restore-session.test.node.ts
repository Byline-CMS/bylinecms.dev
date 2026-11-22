/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { createEditorViewStateStore } from './editor-view-state'
import {
  beginSaveAttempt,
  cancelRestore,
  claimSaveAttempt,
  finishRestore,
  isRestoreLive,
  isSaveAttemptActive,
  settleSaveAttempt,
} from './restore-session'

const target = { path: 'title', role: 'field' as const, offset: 10 }

describe('restore session', () => {
  it('a successful save is live until the restoration finishes', () => {
    const store = createEditorViewStateStore()
    store.setTarget(target)
    const seq = beginSaveAttempt(store)
    expect(isRestoreLive(store)).toBe(false)
    settleSaveAttempt(store, seq, 'success')
    expect(isRestoreLive(store, seq)).toBe(true)
    finishRestore(store, seq)
    expect(isRestoreLive(store)).toBe(false)
  })

  it('a refused save is never live and leaves nothing pending', () => {
    const store = createEditorViewStateStore()
    store.setTarget(target)
    const seq = beginSaveAttempt(store)
    settleSaveAttempt(store, seq, 'refused')
    expect(isRestoreLive(store)).toBe(false)
    expect(store.takePendingRestore(undefined)).toBeNull()
  })

  it('the store sees the session as live when settle notifies its subscribers', () => {
    const store = createEditorViewStateStore()
    const seen: boolean[] = []
    store.subscribe(() => seen.push(isRestoreLive(store)))
    const seq = beginSaveAttempt(store)
    settleSaveAttempt(store, seq, 'success')
    expect(seen).toEqual([true])
  })

  it('cancelling discards the pending restoration and the live session', () => {
    const store = createEditorViewStateStore()
    const seq = beginSaveAttempt(store)
    settleSaveAttempt(store, seq, 'success')
    cancelRestore(store)
    expect(isRestoreLive(store, seq)).toBe(false)
    expect(store.takePendingRestore(undefined)).toBeNull()
  })

  it('moving on while the save is in flight discards its restoration for good', () => {
    const store = createEditorViewStateStore()
    store.setTarget(target)
    const seq = beginSaveAttempt(store)
    expect(isSaveAttemptActive(store)).toBe(true)
    cancelRestore(store)
    expect(isSaveAttemptActive(store)).toBe(false)
    settleSaveAttempt(store, seq, 'success')
    expect(isRestoreLive(store, seq)).toBe(false)
    expect(store.takePendingRestore(undefined)).toBeNull()
  })

  it('a newer save supersedes an older live restoration', () => {
    const store = createEditorViewStateStore()
    const first = beginSaveAttempt(store)
    settleSaveAttempt(store, first, 'success')
    const second = beginSaveAttempt(store)
    expect(isRestoreLive(store, first)).toBe(false)
    settleSaveAttempt(store, first, 'success')
    expect(isRestoreLive(store, first)).toBe(false)
    settleSaveAttempt(store, second, 'success')
    expect(isRestoreLive(store, second)).toBe(true)
  })

  it('a late callback from an older save attempt cannot mark or overwrite the newer save', () => {
    const store = createEditorViewStateStore()
    store.setTarget(target)

    const first = beginSaveAttempt(store)
    const older = claimSaveAttempt(store)

    const second = beginSaveAttempt(store)
    const newer = claimSaveAttempt(store)

    // The older save's host callbacks arrive after the newer save began.
    older.markSaveWarning()
    older.expectRefresh({ revision: 99 })

    newer.expectRefresh({ revision: 8 })
    settleSaveAttempt(store, first, 'success')
    settleSaveAttempt(store, second, 'success')

    expect(store.takePendingRestore(7)).toBeNull()
    const restore = store.takePendingRestore(8)
    expect(restore).toMatchObject({
      saveSeq: second,
      focusWarning: false,
      expectedRevision: 8,
      target,
    })
  })

  it('a claim without a store is inert', () => {
    const attempt = claimSaveAttempt(null)
    expect(() => {
      attempt.markSaveWarning()
      attempt.expectRefresh({ revision: 1 })
    }).not.toThrow()
  })
})
