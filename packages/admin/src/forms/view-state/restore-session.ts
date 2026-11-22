/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { EditorViewStateStore, SaveOutcome } from './editor-view-state'

/**
 * Per-store bookkeeping for the restoration that follows a save.
 *
 * The store owns the pending restoration itself; this module tracks what
 * outlives a single `FormContent` instance while the restoration is carried
 * out — which save attempt is current, which element held focus when it
 * began, and whether the restoration is still live. A version-changing save
 * remounts `FormContent`, so none of this can live in a component.
 *
 * A save attempt is `saving` from `beginSaveAttempt` until it settles. A
 * successful settle makes its restoration `live` until the restoration
 * finishes. Moving on (`cancelRestore`) or a newer save ends either phase, so
 * a restoration belongs to the action that created it.
 */
type SessionPhase = 'saving' | 'live' | 'ended'

interface RestoreSession {
  seq: number
  origin: Element | null
  phase: SessionPhase
}

const sessions = new WeakMap<EditorViewStateStore, RestoreSession>()

/**
 * Ends a session and drops its DOM reference. The visit-long WeakMap entry
 * must not keep the old Save button, and through it a detached form, alive.
 */
function endSession(session: RestoreSession): void {
  session.phase = 'ended'
  session.origin = null
}

let programmaticFocusDepth = 0

/** Begins a save attempt. Called immediately before the host's `onSubmit`. */
export function beginSaveAttempt(store: EditorViewStateStore): number {
  const origin = typeof document === 'undefined' ? null : document.activeElement
  const seq = store.beginSave()
  sessions.set(store, { seq, origin, phase: 'saving' })
  return seq
}

export function settleSaveAttempt(
  store: EditorViewStateStore,
  seq: number,
  outcome: SaveOutcome
): void {
  const session = sessions.get(store)
  // Live before the store notifies, so a waiting form can consume at once. A
  // save the editor moved on from while it was in flight stays ended; the
  // store has already dropped it.
  if (session?.seq === seq && session.phase === 'saving') {
    if (outcome === 'success') session.phase = 'live'
    else endSession(session)
  }
  store.settleSave(seq, outcome)
}

/** Whether a restoration (for `seq`, when given) may still run. */
export function isRestoreLive(store: EditorViewStateStore, seq?: number): boolean {
  const session = sessions.get(store)
  if (session?.phase !== 'live') return false
  return seq === undefined || session.seq === seq
}

/** Whether a save is in flight or its restoration is still live. */
export function isSaveAttemptActive(store: EditorViewStateStore): boolean {
  const phase = sessions.get(store)?.phase
  return phase === 'saving' || phase === 'live'
}

/** The restoration ran (or fell back); nothing more may fire for it. */
export function finishRestore(store: EditorViewStateStore, seq: number): void {
  const session = sessions.get(store)
  if (session?.seq === seq && session.phase === 'live') endSession(session)
}

/** The editor moved on: the pending restoration is discarded and never fires. */
export function cancelRestore(store: EditorViewStateStore): void {
  const session = sessions.get(store)
  if (session) endSession(session)
  store.cancelPendingRestore()
}

/**
 * Whether a DOM event means the editor has moved on, while a save is in
 * flight or its restoration is live. Any `keydown` or `pointerdown` does; a
 * `focusin` does unless it lands on the element that held focus when the save
 * began, or restoration itself moved focus.
 */
export function isMoveOnEvent(store: EditorViewStateStore, event: Event): boolean {
  const session = sessions.get(store)
  if (session == null || session.phase === 'ended') return false
  if (event.type !== 'focusin') return true
  if (programmaticFocusDepth > 0) return false
  return event.target !== session.origin
}

/**
 * Focuses `element` for a restoration without the move-on listener treating
 * it as the editor's own focus change. Returns whether focus landed there.
 */
export function focusForRestore(element: HTMLElement): boolean {
  programmaticFocusDepth++
  try {
    element.focus({ preventScroll: true })
  } finally {
    programmaticFocusDepth--
  }
  return element.ownerDocument.activeElement === element
}

export interface SaveAttempt {
  /** Records the save receipt's revision for this attempt only. */
  expectRefresh(receipt: { revision: number }): void
  /** Flags this attempt's restoration to focus the inline warning. */
  markSaveWarning(): void
}

const INERT_ATTEMPT: SaveAttempt = {
  expectRefresh: () => {},
  markSaveWarning: () => {},
}

/**
 * Claims the save attempt that is calling the host's `onSubmit`. A host calls
 * this synchronously at the top of its submit handler, before its first
 * `await`, and reports the outcome through the returned handle. A callback
 * that arrives after a newer save began is dropped, so an obsolete attempt
 * can neither mark nor overwrite another save's receipt.
 */
export function claimSaveAttempt(store: EditorViewStateStore | null | undefined): SaveAttempt {
  if (!store) return INERT_ATTEMPT
  const seq = sessions.get(store)?.seq
  const isCurrent = () => sessions.get(store)?.seq === seq
  return {
    expectRefresh(receipt) {
      if (isCurrent()) store.expectRefresh(receipt)
    },
    markSaveWarning() {
      if (isCurrent()) store.markSaveWarning()
    },
  }
}
