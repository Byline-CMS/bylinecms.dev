/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Reload admission and focus recovery remain synchronous at event boundaries. */
export function useDocumentReloadRecovery({
  mutationsBlocked,
  mutationIssue,
  onReloadDocument,
  isBusy,
}: {
  mutationsBlocked: boolean
  mutationIssue?: string | null
  onReloadDocument?: () => void | Promise<void>
  isBusy: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const focusBeforeBusyRef = useRef<HTMLElement | null>(null)
  const restoreFocusAfterBusyRef = useRef(false)
  const [discarding, setDiscarding] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)
  const warningRef = useRef<HTMLDivElement>(null)
  const mutationBlockedRef = useRef(mutationsBlocked)
  mutationBlockedRef.current = mutationsBlocked || discarding
  useEffect(() => {
    if (mutationIssue) warningRef.current?.focus()
  }, [mutationIssue])
  useEffect(() => {
    if (!discarding) return
    // Let the guard's beforeunload listener detach before the explicit discard.
    Promise.resolve()
      .then(() => (onReloadDocument ? onReloadDocument() : window.location.reload()))
      .catch(() => {
        setDiscarding(false)
        setReloadFailed(true)
      })
  }, [discarding, onReloadDocument])

  const captureFocusBeforeBusy = useCallback(() => {
    if (focusBeforeBusyRef.current != null) return
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement) || !formRef.current?.contains(activeElement)) return
    focusBeforeBusyRef.current = activeElement
    restoreFocusAfterBusyRef.current = true
  }, [])

  // `inert` removes the active control from the tab order while a save is in
  // flight. Restore the editor's position after React has removed `inert`;
  // when the original control became disabled, fall back to the first usable
  // form control instead of leaving focus on <body>.
  useEffect(() => {
    if (isBusy || !restoreFocusAfterBusyRef.current) return
    restoreFocusAfterBusyRef.current = false

    if (mutationIssue) {
      warningRef.current?.focus()
      focusBeforeBusyRef.current = null
      return
    }
    const original = focusBeforeBusyRef.current
    focusBeforeBusyRef.current = null
    const originalCanReceiveFocus =
      original?.isConnected === true && !original.matches(':disabled, [aria-disabled="true"]')
    const target = originalCanReceiveFocus
      ? original
      : formRef.current?.querySelector<HTMLElement>(
          'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
    target?.focus({ preventScroll: true })
  }, [isBusy, mutationIssue])

  const requestDiscard = useCallback(() => {
    mutationBlockedRef.current = true
    setReloadFailed(false)
    setDiscarding(true)
  }, [])
  return {
    formRef,
    warningRef,
    mutationBlockedRef,
    discarding,
    reloadFailed,
    requestDiscard,
    captureFocusBeforeBusy,
  }
}
