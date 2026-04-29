/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'

/**
 * Modal form-state machine: initialise state from a factory once, and reset
 * it on the **leading edge** of `isOpen` (closed → open). The ref guard is
 * load-bearing — without it, an effect with the factory's source data in its
 * deps would fire every time the parent re-derives the prop, wiping
 * in-progress input mid-edit.
 *
 * The `init` callback is read at fire time (latest render's closure), so
 * factories that close over fresh props will see the correct values.
 *
 * `onReset` runs immediately after the state reset — useful for clearing
 * sibling state such as validation errors that must align with the form.
 */
export function useModalFormState<T>(
  isOpen: boolean,
  init: () => T,
  onReset?: () => void
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(init)

  // Hold the latest `init` / `onReset` in refs so the leading-edge effect
  // doesn't need them in its deps — we want it driven solely by `isOpen`.
  const initRef = useRef(init)
  initRef.current = init
  const onResetRef = useRef(onReset)
  onResetRef.current = onReset

  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setState(initRef.current())
      onResetRef.current?.()
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  return [state, setState]
}
