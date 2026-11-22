/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { findMarker, SYSTEM_TARGETS, topmostVisibleAnchor } from './target-markers'
import type { ActionRole, EditorViewStateStore, SaveOutcome } from './editor-view-state'

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
  // A save supersedes an action that has not been restored yet.
  endActionSession(store)
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
  endActionSession(store)
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
  if (session != null && session.phase !== 'ended') {
    if (event.type !== 'focusin') return true
    if (programmaticFocusDepth > 0) return false
    return event.target !== session.origin
  }
  return isActionMoveOnEvent(store, event)
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

// ---------------------------------------------------------------------------
// Action restorations: the other navigations within the visit
// ---------------------------------------------------------------------------

/**
 * Per-store bookkeeping for an action restoration (a status change, a locale
 * switch, copy to locale). An action is `claimed` when the host starts it,
 * `live` once the host records it just before navigating, and `ended` when
 * the restoration finishes, the editor moves on, or a newer action or save
 * supersedes it.
 */
interface ActionSession {
  claim: object
  seq: number | null
  phase: 'claimed' | 'live' | 'ended'
  /** The control that launched the action, used to tell a split button's menu. */
  origin: Element | null
  /**
   * Where focus is expected to return as the action's own menu, listbox or
   * dialog closes: the noted launcher and the control focused at the claim.
   */
  handbacks: Element[]
  /** The locale the action's navigation lands on, once recorded. */
  toLocale: string | null
}

const actionSessions = new WeakMap<EditorViewStateStore, ActionSession>()
const guardPrompts = new WeakMap<EditorViewStateStore, boolean>()
const restoreForms = new WeakMap<EditorViewStateStore, () => HTMLElement | null>()
const launches = new WeakMap<EditorViewStateStore, Element>()

function endActionSession(store: EditorViewStateStore): void {
  const session = actionSessions.get(store)
  if (session) {
    session.phase = 'ended'
    // The visit-long entry must not keep a detached control alive.
    session.origin = null
    session.handbacks = []
  }
}

/**
 * Reports the content locale a form has committed (`observeContentLocale`).
 * On a change, the previous locale's save attempt ends, so its late settle is
 * a no-op, and an action ends unless it is the transition to this locale.
 */
export function observeCommittedLocale(store: EditorViewStateStore, locale: string): void {
  if (!store.observeContentLocale(locale)) return
  const save = sessions.get(store)
  if (save) endSession(save)
  if (actionSessions.get(store)?.toLocale !== locale) endActionSession(store)
}

/**
 * Names the control that launched the next action, for a launcher that does
 * not hold focus when the host claims it: a split button's menu item has
 * focus then, but the menu's trigger is what survives. Taken by the next
 * `beginActionRestore` on this store.
 */
export function noteActionLaunch(store: EditorViewStateStore, control: Element): void {
  launches.set(store, control)
}

const POPUP_TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"])'
/** Marks the unsaved-changes prompt (`NavigationGuardModal`). */
const NAVIGATION_GUARD = '[data-byline-navigation-guard]'

function isElementLike(target: EventTarget | null): target is Element {
  return (
    target != null &&
    typeof (target as Element).closest === 'function' &&
    typeof (target as Element).matches === 'function'
  )
}

/**
 * Whether a `focusin` during an action is a handback rather than the editor
 * moving on: focus returning to where this action expects it (its launcher,
 * or the control focused when it was claimed), or moving into the
 * unsaved-changes prompt that its navigation opened.
 */
function isFocusHandback(session: ActionSession, target: EventTarget | null): boolean {
  if (target == null) return false
  if (session.handbacks.includes(target as Element)) return true
  if (!isElementLike(target)) return false
  if (target.closest(NAVIGATION_GUARD) != null) return true
  // The prompt's own dialog element, when focus lands on the popup itself.
  return target.matches('[role="dialog"]') && target.querySelector(NAVIGATION_GUARD) != null
}

/**
 * A `keydown`, a `pointerdown` or a `focusin` moves on from a claimed or live
 * action, so focus that assistive technology or another control moved is
 * respected. Restoration's own focus moves and focus handbacks
 * (`isFocusHandback`) are exempt. Answering the unsaved-changes prompt is
 * not moving on either; Stay discards the action explicitly, and Leave lets
 * it run.
 */
function isActionMoveOnEvent(store: EditorViewStateStore, event: Event): boolean {
  const session = actionSessions.get(store)
  if (session == null || session.phase === 'ended') return false
  if (event.type !== 'focusin') return guardPrompts.get(store) !== true
  if (programmaticFocusDepth > 0) return false
  return !isFocusHandback(session, event.target)
}

/** Tells the session whether the unsaved-changes prompt is open. */
export function setGuardPromptOpen(store: EditorViewStateStore, open: boolean): void {
  guardPrompts.set(store, open)
}

/**
 * Registers the form the visit's restorations act on, so a host can record
 * a viewport anchor from outside the form. Returns the unregister function.
 */
export function registerRestoreForm(
  store: EditorViewStateStore,
  getForm: () => HTMLElement | null
): () => void {
  restoreForms.set(store, getForm)
  return () => {
    if (restoreForms.get(store) === getForm) restoreForms.delete(store)
  }
}

/** Whether the action restoration `seq` may still run. */
export function isActionRestoreLive(store: EditorViewStateStore, seq: number): boolean {
  const session = actionSessions.get(store)
  return session?.phase === 'live' && session.seq === seq
}

/** The action restoration ran (or fell back); nothing more may fire for it. */
export function finishActionRestore(store: EditorViewStateStore, seq: number): void {
  if (isActionRestoreLive(store, seq)) endActionSession(store)
}

export interface ActionRestoreClaim {
  /**
   * Records the action just before its navigation: the starting control, the
   * topmost visible marker and its offset, the locale the navigation lands
   * on and the action receipt's revision. Clears nothing. A no-op when the
   * editor moved on, or a newer action or save began, since the claim.
   */
  record(details?: { toLocale?: string | null; expectedRevision?: number | null }): void
}

const INERT_CLAIM: ActionRestoreClaim = { record: () => {} }

/**
 * Claims an in-visit navigation that the host starts. A host calls this
 * synchronously when the action starts, before its first `await`, and
 * records the action through the returned handle just before navigating.
 * Moving on in between discards it, as it does a save restoration.
 *
 * `role` is the starting control's marker role. `fallbackRole` names the
 * control focused when that one is gone, such as the locale selector for
 * the locale actions.
 */
export function beginActionRestore(
  store: EditorViewStateStore | null | undefined,
  {
    role,
    fallbackRole = null,
    fromLocale = null,
  }: { role: ActionRole; fallbackRole?: ActionRole | null; fromLocale?: string | null }
): ActionRestoreClaim {
  if (!store) return INERT_CLAIM
  const claim = {}
  const noted = launches.get(store) ?? null
  launches.delete(store)
  const focused = typeof document === 'undefined' ? null : document.activeElement
  const origin = noted ?? focused
  const handbacks = [noted, focused].filter((element): element is Element => element != null)
  actionSessions.set(store, {
    claim,
    seq: null,
    phase: 'claimed',
    origin,
    handbacks,
    toLocale: null,
  })
  return {
    record({ toLocale = null, expectedRevision = null } = {}) {
      const session = actionSessions.get(store)
      if (session?.claim !== claim || session.phase !== 'claimed') return
      // The action supersedes a save restoration that is still pending.
      const save = sessions.get(store)
      if (save) endSession(save)
      const form = restoreForms.get(store)?.() ?? null
      const marker = form ? findMarker(form, SYSTEM_TARGETS.document, role) : null
      const origin = session.origin
      const launchedFromPopup =
        marker != null &&
        isElementLike(origin) &&
        marker.contains(origin) &&
        origin.matches(POPUP_TRIGGER)
      session.phase = 'live'
      session.toLocale = toLocale
      // Live, with its exact identity, before the store notifies, so a
      // waiting form can consume at once and an older wait sees it is stale.
      store.setActionRestore(
        {
          role,
          fallbackRole,
          anchor: form ? topmostVisibleAnchor(form) : null,
          fromLocale,
          toLocale,
          expectedRevision,
          launchedFromPopup,
        },
        (seq) => {
          session.seq = seq
        }
      )
    },
  }
}
