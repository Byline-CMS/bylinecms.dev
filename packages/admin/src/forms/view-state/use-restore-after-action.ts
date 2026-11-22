/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type RefObject, useCallback, useEffect } from 'react'

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
import {
  finishActionRestore,
  focusForRestore,
  isActionRestoreLive,
  registerRestoreForm,
} from './restore-session'
import { findMarker, SYSTEM_TARGETS } from './target-markers'
import { scrollByInstantly, useRestoration } from './use-restoration'
import type { PendingActionRestore, ViewAnchor } from './editor-view-state'

const POPUP_TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"])'

function isHidden(element: Element): boolean {
  return element.closest('[hidden], .byline-sortable-content-hidden') != null
}

/**
 * Restores focus and scroll after the editor's other navigations within the
 * visit: a status change, unpublishing, scheduling, a locale switch, copy to
 * locale and delete locale (spec §5.7). Runs only inside a form with a visit
 * store.
 *
 * The host claims the action when it starts and records it just before
 * navigating (`beginActionRestore`). A form instance consumes it once it has
 * rendered the locale the navigation lands on and the action receipt's
 * revision; a locale switch therefore restores in the remounted form, and a
 * status change in the surviving one. Focus goes to the control that started
 * the action, then to its fallback control (the locale selector, for the
 * locale actions), then to the save fallbacks from the working target. The
 * topmost visible marker recorded before the navigation is put back at its
 * viewport offset. Moving on cancels it, as it does a save restoration.
 */
export function useRestoreAfterAction(
  formRef: RefObject<HTMLFormElement | null>,
  {
    locale,
    revision,
    fields,
  }: {
    locale: string | undefined
    revision: unknown
    fields: readonly Field[]
  }
): void {
  const store = useEditorViewState()
  const { getFieldValues } = useFormContext()
  const renderedRevision = typeof revision === 'number' ? revision : undefined

  // Lets the host record a viewport anchor from outside the form.
  const getForm = useCallback(() => formRef.current, [formRef])
  useEffect(() => (store ? registerRestoreForm(store, getForm) : undefined), [getForm, store])

  useRestoration<PendingActionRestore>(
    formRef,
    store,
    {
      take: () => store?.takeActionRestore({ locale, revision: renderedRevision }) ?? null,
      isLive: (restore) => store != null && isActionRestoreLive(store, restore.actionSeq),
      finish: (restore) => {
        if (store) finishActionRestore(store, restore.actionSeq)
      },
      attempt: (restore, final) => {
        if (store == null) return true
        const form = formRef.current
        if (form == null || !form.isConnected || form.closest('[inert]')) {
          if (!final) return false
          finishActionRestore(store, restore.actionSeq)
          return true
        }

        /** The element to focus, or `null` while it may still be mounting. */
        const resolveFocus = (): HTMLElement | null => {
          for (const role of [restore.role, restore.fallbackRole]) {
            if (role == null) continue
            const marker = findMarker(form, SYSTEM_TARGETS.document, role)
            if (marker == null) continue
            // A split button's menu launched it: its trigger, when it survives.
            if (role === restore.role && restore.launchedFromPopup) {
              const trigger = marker.querySelector(POPUP_TRIGGER)
              if (trigger && isUsable(trigger)) return trigger
            }
            const control = findExactControl(form, {
              path: SYSTEM_TARGETS.document,
              role,
              offset: null,
            })
            if (control) return control
            // Rendered but not usable yet: a status control stays disabled
            // until its action's handler settles.
            if (!final) return null
          }
          const target = restore.target
          if (target == null) return formHeading(form) ?? form
          const exact = findExactControl(form, target)
          if (exact) return exact
          if (
            !final &&
            isExactControlPending(form, target) &&
            !isTargetGone(form, target, fields, getFieldValues())
          ) {
            return null
          }
          return resolveRestoreTarget(form, target)
        }

        const anchorMarker = (anchor: ViewAnchor | null): HTMLElement | null =>
          anchor == null ? null : findMarker(form, anchor.path, anchor.role)
        const anchorPending =
          restore.anchor != null &&
          anchorMarker(restore.anchor) == null &&
          !isTargetGone(form, restore.anchor, fields, getFieldValues())

        const element = resolveFocus()
        if (element == null || (anchorPending && !final)) return false

        finishActionRestore(store, restore.actionSeq)
        if (!focusForRestore(element)) {
          // Never leave focus on <body>: the heading is always focusable.
          const heading = formHeading(form)
          if (heading) focusForRestore(heading)
        }
        // Keep the scroll position: the topmost marker returns to its offset.
        const marker = anchorMarker(restore.anchor)
        if (restore.anchor && marker && !isHidden(marker)) {
          scrollByInstantly(marker.getBoundingClientRect().top - restore.anchor.offset)
        }
        return true
      },
    },
    `${locale ?? ''}|${String(renderedRevision)}`
  )
}
