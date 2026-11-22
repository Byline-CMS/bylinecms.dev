/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type RefObject, useCallback, useEffect, useRef } from 'react'

import type { Field } from '@byline/core'

import { useFormContext } from '../form-context'
import { hasExistingIdTargets } from '../nested-path'
import { useEditorViewState } from './editor-view-state-context'
import {
  findExactControl,
  formHeading,
  isExactControlPending,
  isUsable,
  resolveRestoreTarget,
  tabSetContaining,
  topLevelName,
} from './resolve-target'
import { finishRestore, focusForRestore, isRestoreLive } from './restore-session'
import { findMarker, TARGET_ATTR } from './target-markers'
import { trustedAddress } from './view-state-address'
import type { PendingRestore, ViewTarget } from './editor-view-state'

/**
 * Bounds for waiting on a target that is still mounting. The wait ends once
 * the form has had no DOM mutation for this many frames or milliseconds,
 * whichever comes first, and never runs longer than the hard cap.
 */
const QUIET_FRAMES = 30
const QUIET_MS = 500
const MAX_WAIT_MS = 5000

/** A recorded offset is reused only while the element's top stays this far inside the viewport. */
const BOTTOM_MARGIN_PX = 40

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(handle)
  }
  const handle = setTimeout(callback, 16)
  return () => clearTimeout(handle)
}

/**
 * Calls `attempt(final)` once per animation frame until it reports done.
 * `final` turns true once the form has gone quiet (or the cap is reached),
 * and the attempt must then finish, falling back if it has to.
 */
function waitForTarget(form: HTMLElement, attempt: (final: boolean) => boolean): () => void {
  const start = now()
  let lastMutation = start
  let quietFrames = 0
  let cancelFrame: () => void = () => {}
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          quietFrames = 0
          lastMutation = now()
        })
      : null
  observer?.observe(form, { childList: true, subtree: true, attributes: true })

  const stop = () => {
    observer?.disconnect()
    cancelFrame()
  }
  const tick = () => {
    quietFrames++
    const time = now()
    const final =
      quietFrames >= QUIET_FRAMES || time - lastMutation >= QUIET_MS || time - start >= MAX_WAIT_MS
    if (attempt(final)) {
      stop()
      return
    }
    cancelFrame = nextFrame(tick)
  }
  cancelFrame = nextFrame(tick)
  return stop
}

function scrollIntoViewInstantly(element: HTMLElement): void {
  // `html { scroll-behavior: smooth }` would otherwise animate, and the
  // editor's next input could cancel the animation part-way.
  element.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
}

/** Scrolls so the element's marker sits at the recorded viewport offset. */
function scrollToOffset(element: HTMLElement, offset: number): void {
  const anchor = element.closest(`[${TARGET_ATTR}]`) ?? element
  const delta = anchor.getBoundingClientRect().top - offset
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' })
}

function offsetIsUsable(offset: number | null): offset is number {
  return offset != null && offset >= 0 && offset <= window.innerHeight - BOTTOM_MARGIN_PX
}

/**
 * Returns focus and scroll to the working target once a successful save has
 * refreshed the form. Runs only inside a form with a visit store; without
 * one, `useDocumentReloadRecovery` keeps today's behaviour.
 *
 * The readiness contract:
 *
 *   1. The host records the save receipt's revision (`expectRefresh`).
 *   2. A form instance consumes the pending restoration only once its
 *      rendered revision has reached that receipt, in a committed effect. For
 *      a version-changing save only the remounted instance qualifies; for a
 *      path-only save the surviving instance does when it re-renders.
 *   3. When the target's marker is not rendered yet but its data still
 *      exists, the hook waits frame by frame for it (bounded); when the data
 *      is gone, it falls back at once.
 *   4. Moving on (focus elsewhere, a key, a pointer) or a newer save ends the
 *      restoration at any point, including during the wait.
 *
 * A consumed restoration is kept in a ref, so a StrictMode effect replay
 * resumes it; a real unmount ends it.
 */
export function useRestoreAfterSave(
  formRef: RefObject<HTMLFormElement | null>,
  {
    warningRef,
    revision,
    fields,
  }: {
    warningRef: RefObject<HTMLElement | null>
    revision: unknown
    fields: readonly Field[]
  }
): void {
  const store = useEditorViewState()
  const { getFieldValues } = useFormContext()
  const consumedRef = useRef<PendingRestore | null>(null)
  const renderedRevision = typeof revision === 'number' ? revision : undefined

  /** The target's data is gone, or it can never mount: fall back without waiting. */
  const isTargetGone = useCallback(
    (form: HTMLElement, target: ViewTarget): boolean => {
      const trusted = trustedAddress(target.path)
      const name = trusted === '' ? null : topLevelName(trusted)
      if (name == null) return true
      if (!fields.some((field) => 'name' in field && field.name === name)) return true
      // A field under an unselected tab is not rendered and will not be.
      if (tabSetContaining(form, name) && findMarker(form, name, 'field') == null) return true
      return !hasExistingIdTargets(getFieldValues(), trusted)
    },
    [fields, getFieldValues]
  )

  /** One restoration attempt. Returns true when the restoration is finished. */
  const attempt = useCallback(
    (final: boolean): boolean => {
      const restore = consumedRef.current
      if (store == null || restore == null) return true
      if (!isRestoreLive(store, restore.saveSeq)) {
        consumedRef.current = null
        return true
      }
      const form = formRef.current
      if (form == null || !form.isConnected || form.closest('[inert]')) {
        if (!final) return false
        // The form never became usable within the bound: give up quietly.
        consumedRef.current = null
        finishRestore(store, restore.saveSeq)
        return true
      }

      const complete = (element: HTMLElement, exact: boolean, offset: number | null) => {
        consumedRef.current = null
        finishRestore(store, restore.saveSeq)
        let focused = element
        if (!focusForRestore(element)) {
          // Never leave focus on <body>: the heading is always focusable.
          const heading = formHeading(form)
          if (heading && focusForRestore(heading)) focused = heading
        }
        if (exact && focused === element && offsetIsUsable(offset)) scrollToOffset(focused, offset)
        else scrollIntoViewInstantly(focused)
        return true
      }

      if (restore.focusWarning) {
        const warning = warningRef.current
        if (warning && isUsable(warning)) return complete(warning, false, null)
        if (!final) return false
      }

      const target = restore.target
      if (target == null) {
        const heading = formHeading(form)
        return complete(heading ?? form, false, null)
      }

      const exact = findExactControl(form, target)
      if (exact) return complete(exact, true, target.offset)

      if (!final && isExactControlPending(form, target) && !isTargetGone(form, target)) {
        return false
      }
      return complete(resolveRestoreTarget(form, target), false, null)
    },
    [formRef, isTargetGone, store, warningRef]
  )
  // Read through a ref so a re-render with new callbacks does not restart a wait.
  const attemptRef = useRef(attempt)
  attemptRef.current = attempt
  const generationRef = useRef(0)

  useEffect(() => {
    if (store == null) return
    const generation = ++generationRef.current
    let disposed = false
    let stopWaiting: (() => void) | null = null

    const proceed = () => {
      if (disposed) return
      if (stopWaiting) {
        // A wait is running. Keep it unless a newer save (or a move-on) has
        // made its restoration obsolete; then drop it and reconcile now,
        // because the notification that made the newer one eligible may be
        // the last one it gets.
        const waiting = consumedRef.current
        if (waiting != null && isRestoreLive(store, waiting.saveSeq)) return
        stopWaiting()
        stopWaiting = null
        consumedRef.current = null
      }
      if (consumedRef.current == null) {
        const taken = store.takePendingRestore(renderedRevision)
        if (taken == null || !isRestoreLive(store, taken.saveSeq)) return
        consumedRef.current = taken
      }
      if (attemptRef.current(false)) return
      const form = formRef.current
      if (form == null) return
      stopWaiting = waitForTarget(form, (final) => {
        const done = attemptRef.current(final)
        if (done) {
          stopWaiting = null
          // The wait may have ended because it was superseded: pick up a
          // newer pending restoration rather than waiting for another notify.
          queueMicrotask(proceed)
        }
        return done
      })
    }

    proceed()
    // A save can settle after this instance has already rendered the new
    // revision (the singleton host refreshes before its submit resolves).
    const unsubscribe = store.subscribe(proceed)
    return () => {
      disposed = true
      unsubscribe()
      stopWaiting?.()
      stopWaiting = null
      // A StrictMode replay or a dependency change re-runs this effect in the
      // same flush and resumes the consumed restoration. A real unmount does
      // not: end the restoration so it neither fires later nor keeps the
      // session live (which would keep suppressing the mutation-issue focus).
      queueMicrotask(() => {
        const orphaned = consumedRef.current
        if (generationRef.current !== generation || orphaned == null) return
        consumedRef.current = null
        finishRestore(store, orphaned.saveSeq)
      })
    }
  }, [formRef, renderedRevision, store])
}
