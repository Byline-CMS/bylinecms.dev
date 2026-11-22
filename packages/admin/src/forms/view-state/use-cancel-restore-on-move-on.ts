/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'

import { useEditorViewState } from './editor-view-state-context'
import { cancelRestore, isMoveOnEvent } from './restore-session'

const MOVE_ON_EVENTS = ['focusin', 'keydown', 'pointerdown'] as const

/**
 * While a restoration is pending, discards it when the editor moves on: the
 * first `focusin` outside the control that held focus when the save began,
 * or the first `keydown` or `pointerdown`. Focus and scroll then stay where
 * the editor put them. It listens on the document in the capture phase, so it
 * sees events from portals and from outside the form. Each mounted form
 * instance installs its own listener and all of them act on the same
 * per-store session, so cancellation keeps working across a remount.
 */
export function useCancelRestoreOnMoveOn(): void {
  const store = useEditorViewState()
  useEffect(() => {
    if (store == null) return
    const onEvent = (event: Event) => {
      if (isMoveOnEvent(store, event)) cancelRestore(store)
    }
    for (const type of MOVE_ON_EVENTS) document.addEventListener(type, onEvent, true)
    return () => {
      for (const type of MOVE_ON_EVENTS) document.removeEventListener(type, onEvent, true)
    }
  }, [store])
}
