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
  beginActionRestore,
  beginSaveAttempt,
  cancelRestore,
  claimSaveAttempt,
  finishActionRestore,
  finishRestore,
  isActionRestoreLive,
  isMoveOnEvent,
  isRestoreLive,
  isSaveAttemptActive,
  noteActionLaunch,
  observeCommittedLocale,
  setGuardPromptOpen,
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

describe('action restore session', () => {
  const rendered = { locale: 'en', revision: 8 }
  const event = (type: string) => ({ type, target: null }) as unknown as Event

  it('a claimed action records once and is live until it finishes', () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:status', fromLocale: 'en' }).record({
      expectedRevision: 8,
    })
    const restore = store.takeActionRestore(rendered)
    expect(restore).toMatchObject({ role: 'action:status', expectedRevision: 8, toLocale: null })
    if (restore == null) throw new Error('nothing recorded')
    expect(isActionRestoreLive(store, restore.actionSeq)).toBe(true)
    finishActionRestore(store, restore.actionSeq)
    expect(isActionRestoreLive(store, restore.actionSeq)).toBe(false)
  })

  it('the store sees the action as live when recording notifies its subscribers', () => {
    const store = createEditorViewStateStore()
    const seen: boolean[] = []
    store.subscribe(() => {
      const restore = store.takeActionRestore(rendered)
      if (restore) seen.push(isActionRestoreLive(store, restore.actionSeq))
    })
    beginActionRestore(store, { role: 'action:status' }).record({ expectedRevision: 8 })
    expect(seen).toEqual([true])
  })

  it('moving on between the claim and the record discards the action for good', () => {
    const store = createEditorViewStateStore()
    const claim = beginActionRestore(store, { role: 'action:status' })
    expect(isMoveOnEvent(store, event('keydown'))).toBe(true)
    cancelRestore(store)
    claim.record({ expectedRevision: 8 })
    expect(store.takeActionRestore(rendered)).toBeNull()
  })

  it('a key or pointer moves on from an action', () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:status' }).record({ expectedRevision: 8 })
    expect(isMoveOnEvent(store, event('pointerdown'))).toBe(true)
    expect(isMoveOnEvent(store, event('keydown'))).toBe(true)
  })

  /** A stand-in DOM element: `closest` and `matches` answer from the given selectors. */
  const element = (matching: string[] = [], within: string[] = []) =>
    ({
      matches: (selector: string) => matching.includes(selector),
      closest: (selector: string) =>
        within.includes(selector) || matching.includes(selector) ? {} : null,
      querySelector: () => null,
    }) as unknown as Element
  const focusin = (target: Element) => ({ type: 'focusin', target }) as unknown as Event

  it('an unrelated focus change moves on from an action without a key or pointer', () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:status' }).record({ expectedRevision: 8 })
    expect(isMoveOnEvent(store, focusin(element()))).toBe(true)
  })

  it('focus handed back to the control that launched the action is not moving on', () => {
    const store = createEditorViewStateStore()
    const trigger = element()
    noteActionLaunch(store, trigger)
    beginActionRestore(store, { role: 'action:status' }).record({ expectedRevision: 8 })
    expect(isMoveOnEvent(store, focusin(trigger))).toBe(false)
  })

  it("focus on another action's popup trigger, or in an unrelated dialog, moves on", () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:copy-locale' }).record({ toLocale: 'fr' })
    const otherTrigger = element(
      ['[aria-haspopup]:not([aria-haspopup="false"])'],
      ['[data-byline-target="$document"]']
    )
    expect(isMoveOnEvent(store, focusin(otherTrigger))).toBe(true)
    const dialogButton = element([], ['[role="dialog"], [role="alertdialog"]', '[role="dialog"]'])
    expect(isMoveOnEvent(store, focusin(dialogButton))).toBe(true)
  })

  it('focus moving into the unsaved-changes prompt is not moving on', () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:locale', fromLocale: 'en' }).record({
      toLocale: 'fr',
    })
    const guardButton = element([], ['[data-byline-navigation-guard]'])
    expect(isMoveOnEvent(store, focusin(guardButton))).toBe(false)
  })

  it('a noted launcher and the control focused at the claim are both handbacks', () => {
    const store = createEditorViewStateStore()
    const trigger = element()
    noteActionLaunch(store, trigger)
    beginActionRestore(store, { role: 'action:locale' }).record({ toLocale: 'fr' })
    expect(isMoveOnEvent(store, focusin(trigger))).toBe(false)
    expect(isMoveOnEvent(store, focusin(element()))).toBe(true)
  })

  it('a previous-locale save that settles after a committed locale change is never live', () => {
    const store = createEditorViewStateStore()
    observeCommittedLocale(store, 'en')
    const seq = beginSaveAttempt(store)
    claimSaveAttempt(store)
    observeCommittedLocale(store, 'fr')
    expect(isSaveAttemptActive(store)).toBe(false)
    settleSaveAttempt(store, seq, 'success')
    expect(isRestoreLive(store, seq)).toBe(false)
    expect(store.takePendingRestore(undefined)).toBeNull()
  })

  it('the locale action whose locale commits stays live; another action ends', () => {
    const store = createEditorViewStateStore()
    observeCommittedLocale(store, 'en')
    beginActionRestore(store, { role: 'action:locale', fromLocale: 'en' }).record({
      toLocale: 'fr',
    })
    observeCommittedLocale(store, 'fr')
    const kept = store.takeActionRestore({ locale: 'fr', revision: 7 })
    if (kept == null) throw new Error('locale action dropped')
    expect(isActionRestoreLive(store, kept.actionSeq)).toBe(true)

    beginActionRestore(store, { role: 'action:status', fromLocale: 'fr' }).record()
    observeCommittedLocale(store, 'de')
    expect(store.takeActionRestore({ locale: 'de', revision: 7 })).toBeNull()
    expect(isMoveOnEvent(store, event('keydown'))).toBe(false)
  })

  it('an action whose restoration is waiting is not live while a newer action notifies', () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:status' }).record({ expectedRevision: 8 })
    const first = store.takeActionRestore(rendered)
    if (first == null) throw new Error('nothing recorded')
    const seen: Array<[boolean, boolean]> = []
    store.subscribe(() => {
      const second = store.takeActionRestore(rendered)
      if (second) {
        seen.push([
          isActionRestoreLive(store, first.actionSeq),
          isActionRestoreLive(store, second.actionSeq),
        ])
      }
    })
    beginActionRestore(store, { role: 'action:unpublish' }).record({ expectedRevision: 8 })
    expect(seen).toEqual([[false, true]])
  })

  it('answering the unsaved-changes prompt is not moving on', () => {
    const store = createEditorViewStateStore()
    beginActionRestore(store, { role: 'action:locale', fromLocale: 'en' }).record({
      toLocale: 'fr',
    })
    setGuardPromptOpen(store, true)
    expect(isMoveOnEvent(store, event('pointerdown'))).toBe(false)
    expect(isMoveOnEvent(store, event('keydown'))).toBe(false)
    setGuardPromptOpen(store, false)
    expect(isMoveOnEvent(store, event('pointerdown'))).toBe(true)
  })

  it('a save supersedes a claimed action, and a recorded action supersedes a live save', () => {
    const store = createEditorViewStateStore()
    const claim = beginActionRestore(store, { role: 'action:status' })
    beginSaveAttempt(store)
    claim.record({ expectedRevision: 8 })
    expect(store.takeActionRestore(rendered)).toBeNull()

    const seq = beginSaveAttempt(store)
    settleSaveAttempt(store, seq, 'success')
    beginActionRestore(store, { role: 'action:status' }).record({ expectedRevision: 8 })
    expect(isRestoreLive(store, seq)).toBe(false)
    expect(store.takePendingRestore(undefined)).toBeNull()
  })

  it('a newer claim makes an older claim inert', () => {
    const store = createEditorViewStateStore()
    const older = beginActionRestore(store, { role: 'action:status' })
    const newer = beginActionRestore(store, { role: 'action:unpublish' })
    older.record({ expectedRevision: 9 })
    expect(store.takeActionRestore(rendered)).toBeNull()
    newer.record({ expectedRevision: 8 })
    expect(store.takeActionRestore(rendered)?.role).toBe('action:unpublish')
  })

  it('a claim without a store is inert', () => {
    expect(() => beginActionRestore(undefined, { role: 'action:status' }).record()).not.toThrow()
  })
})
