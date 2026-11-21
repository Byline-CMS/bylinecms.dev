/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { isTrustedAddress } from './view-state-address'

export type TargetRole = 'field' | 'grip' | 'toggle' | 'menu' | `action:${string}`

export interface ViewTarget {
  path: string
  role: TargetRole
  offset: number | null
}

export type SaveOutcome = 'success' | 'refused'

export interface PendingRestore {
  saveSeq: number
  target: ViewTarget | null
  focusWarning: boolean
  expectedRevision: number | null
}

export interface EditorViewStateStore {
  getTab(tabSet: string): string | undefined
  setTab(tabSet: string, tab: string): void
  isCollapsed(itemPath: string): boolean
  setCollapsed(itemPath: string, collapsed: boolean): void
  getTarget(): ViewTarget | null
  setTarget(target: ViewTarget): void
  clearTarget(): void
  /** Starts a save, snapshotting the current target. Supersedes any earlier save. */
  beginSave(): number
  /** Flags the most recently begun save; its restoration focuses the warning. */
  markSaveWarning(): void
  /** Records the receipt revision of the most recently begun save. */
  expectRefresh(receipt: { revision: number }): void
  settleSave(saveSeq: number, outcome: SaveOutcome): void
  /** Returns the pending restoration once, and only once the rendered revision has caught up. */
  takePendingRestore(renderedRevision: number | undefined): PendingRestore | null
  /** The user moved on; nothing pending fires. */
  cancelPendingRestore(): void
  subscribe(listener: () => void): () => void
}

export function createEditorViewStateStore(): EditorViewStateStore {
  const tabs = new Map<string, string>()
  const collapsed = new Set<string>()
  const listeners = new Set<() => void>()
  let target: ViewTarget | null = null
  let seq = 0
  // The most recently begun save; null once settled or cancelled.
  let current: PendingRestore | null = null
  let pending: PendingRestore | null = null

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    getTab: (tabSet) => tabs.get(tabSet),
    setTab(tabSet, tab) {
      tabs.set(tabSet, tab)
      notify()
    },
    isCollapsed: (itemPath) => collapsed.has(itemPath),
    setCollapsed(itemPath, value) {
      // Positional addresses are not stable across reorders.
      if (!isTrustedAddress(itemPath)) return
      if (value) collapsed.add(itemPath)
      else collapsed.delete(itemPath)
      notify()
    },
    getTarget: () => target,
    setTarget(next) {
      target = next
      notify()
    },
    clearTarget() {
      target = null
      notify()
    },
    beginSave() {
      seq += 1
      pending = null
      current = {
        saveSeq: seq,
        target: target ? { ...target } : null,
        focusWarning: false,
        expectedRevision: null,
      }
      return seq
    },
    markSaveWarning() {
      if (current) current.focusWarning = true
    },
    expectRefresh(receipt) {
      if (current) current.expectedRevision = receipt.revision
    },
    settleSave(saveSeq, outcome) {
      if (!current || current.saveSeq !== saveSeq) return
      const settled = current
      current = null
      if (outcome === 'success') {
        pending = settled
        // A replacement form may already be mounted and waiting for this.
        notify()
      }
    },
    takePendingRestore(renderedRevision) {
      if (!pending) return null
      if (
        pending.expectedRevision !== null &&
        (renderedRevision === undefined || renderedRevision < pending.expectedRevision)
      ) {
        return null
      }
      const result = pending
      pending = null
      return result
    },
    cancelPendingRestore() {
      const hadPending = pending !== null
      pending = null
      current = null
      if (hadPending) notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
