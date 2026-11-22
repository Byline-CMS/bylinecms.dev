/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RefObject } from 'react'

import type { Field } from '@byline/core'

import { useFormContext } from '../form-context'
import { useEditorViewState } from './editor-view-state-context'
import {
  findExactControl,
  formHeading,
  isExactControlPending,
  isTargetGone,
  isUsable,
  resolveRestoreTarget,
} from './resolve-target'
import { finishRestore, focusForRestore, isRestoreLive } from './restore-session'
import { replaySelection } from './selection-memory'
import { TARGET_ATTR } from './target-markers'
import { scrollByInstantly, scrollIntoViewInstantly, useRestoration } from './use-restoration'
import type { PendingRestore, ViewTarget } from './editor-view-state'

/** Scrolls so the element's marker sits at the recorded viewport offset. */
function scrollToOffset(element: HTMLElement, offset: number): void {
  const anchor = element.closest(`[${TARGET_ATTR}]`) ?? element
  scrollByInstantly(anchor.getBoundingClientRect().top - offset)
}

/**
 * A recorded signed offset is reused only when the target overlapped the
 * viewport at record time (it may have been partly above it); an entirely
 * offscreen target falls back to scrolling it into view.
 */
function offsetIsUsable(target: ViewTarget | null): target is ViewTarget & { offset: number } {
  if (target?.offset == null) return false
  return target.intersecting ?? target.offset >= 0
}

/** The restored caret's rect when the selection sits inside `element`, else null. */
function caretRect(element: HTMLElement): DOMRect | null {
  const selection = element.ownerDocument.getSelection?.()
  if (selection == null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return null
  const rect = range.getClientRects?.()[0] ?? range.getBoundingClientRect?.()
  if (rect == null || (rect.width === 0 && rect.height === 0 && rect.top === 0)) return null
  return rect
}

/**
 * After the scroll is applied, brings the control (or its caret, when it
 * has one) into view if a shorter layout or a clamped scroll left it out.
 */
function ensureVisible(element: HTMLElement): void {
  const caret = caretRect(element)
  if (caret) {
    if (caret.bottom > window.innerHeight) scrollByInstantly(caret.bottom - window.innerHeight)
    else if (caret.top < 0) scrollByInstantly(caret.top)
    return
  }
  const rect = element.getBoundingClientRect()
  if (!(rect.top < window.innerHeight && rect.bottom > 0)) scrollIntoViewInstantly(element)
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
 * `useRestoration` carries out steps 2 to 4.
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
  const renderedRevision = typeof revision === 'number' ? revision : undefined

  useRestoration<PendingRestore>(
    formRef,
    store,
    {
      take: () => store?.takePendingRestore(renderedRevision) ?? null,
      isLive: (restore) => store != null && isRestoreLive(store, restore.saveSeq),
      finish: (restore) => {
        if (store) finishRestore(store, restore.saveSeq)
      },
      attempt: (restore, final) => {
        if (store == null) return true
        const form = formRef.current
        if (form == null || !form.isConnected || form.closest('[inert]')) {
          if (!final) return false
          // The form never became usable within the bound: give up quietly.
          finishRestore(store, restore.saveSeq)
          return true
        }

        const complete = (element: HTMLElement, exact: boolean, placed: ViewTarget | null) => {
          finishRestore(store, restore.saveSeq)
          let focused = element
          if (!focusForRestore(element)) {
            // Never leave focus on <body>: the heading is always focusable.
            const heading = formHeading(form)
            if (heading && focusForRestore(heading)) focused = heading
          }
          if (exact && focused === element && offsetIsUsable(placed)) {
            scrollToOffset(focused, placed.offset)
            ensureVisible(focused)
          } else {
            scrollIntoViewInstantly(focused)
          }
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
        if (exact) {
          complete(exact, true, target)
          // Only the exact control, and only once it holds focus, may get
          // its caret or selection back.
          if (exact.ownerDocument.activeElement === exact) {
            replaySelection(store, restore.saveSeq, target.path, exact)
          }
          return true
        }

        if (
          !final &&
          isExactControlPending(form, target) &&
          !isTargetGone(form, target, fields, getFieldValues())
        ) {
          return false
        }
        return complete(resolveRestoreTarget(form, target), false, null)
      },
    },
    String(renderedRevision)
  )
}
