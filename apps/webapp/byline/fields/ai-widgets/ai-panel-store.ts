/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Tiny per-field-path open/closed store for the AI panel. The `Label`
 * slot (toggle button) and the `afterField` slot (panel) for the same
 * field render as siblings in the form, so they coordinate through this
 * module-level store rather than React context.
 */

import { useSyncExternalStore } from 'react'

type Listener = () => void

const openByPath = new Map<string, boolean>()
const listenersByPath = new Map<string, Set<Listener>>()

function notify(path: string): void {
  const set = listenersByPath.get(path)
  if (set == null) return
  for (const listener of set) listener()
}

function subscribe(path: string, listener: Listener): () => void {
  let set = listenersByPath.get(path)
  if (set == null) {
    set = new Set()
    listenersByPath.set(path, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
  }
}

export function useAiPanelOpen(path: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (listener) => subscribe(path, listener),
    () => openByPath.get(path) ?? false,
    () => false
  )
  const setOpen = (next: boolean) => {
    openByPath.set(path, next)
    notify(path)
  }
  return [open, setOpen]
}
