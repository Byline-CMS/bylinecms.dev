/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { isTrustedAddress } from './view-state-address'

export type ActionRole = `action:${string}`

export type TargetRole = 'field' | 'grip' | 'toggle' | 'menu' | ActionRole

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

/** The topmost visible marker before a navigation, and its viewport offset. */
export interface ViewAnchor {
  path: string
  role: TargetRole
  offset: number
}

/**
 * What an in-visit navigation (a status change, a locale switch) restores
 * once the editor has refreshed: focus on the control that started it, and
 * the scroll position through a viewport anchor.
 */
interface ActionRestoreInput {
  /** The marker role of the control that started the action. */
  role: ActionRole
  /** Focused when `role`'s control is gone (the locale selector, for locale actions). */
  fallbackRole: ActionRole | null
  anchor: ViewAnchor | null
  /** The content locale the action started from. */
  fromLocale: string | null
  /** The content locale the navigation lands on; `null` when it does not change the URL locale. */
  toLocale: string | null
  /** The action receipt's revision; the refreshed form must have rendered it. */
  expectedRevision: number | null
  /**
   * The action was launched from a popup trigger inside the starting control
   * (a split button's menu), which is focused again when it survives.
   */
  launchedFromPopup?: boolean
}

export interface PendingActionRestore extends ActionRestoreInput {
  actionSeq: number
  /** The working target when the action was recorded; `null` after a locale change. */
  target: ViewTarget | null
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
  /**
   * Records an action restoration, snapshotting the working target. It
   * supersedes any earlier action restoration and any pending save
   * restoration. Nothing is cleared yet.
   */
  setActionRestore(input: ActionRestoreInput, onSeq?: (actionSeq: number) => void): number
  /**
   * Returns the action restoration once, and only once the rendered form has
   * reached its locale and revision. When the locale changed, the working
   * target is cleared at this point.
   */
  takeActionRestore(rendered: {
    locale: string | undefined
    revision: number | undefined
  }): PendingActionRestore | null
  /** The user moved on; nothing pending fires. */
  cancelPendingRestore(): void
  /**
   * Reports the content locale a form has committed. When it differs from the
   * previously observed one, everything bound to the previous language's text
   * is dropped, whether or not an action restoration runs (a history
   * navigation or a cancelled restoration still changed the language): the
   * working target, a pending or in-flight save restoration (whose settle
   * then creates nothing), and any action restoration other than the
   * transition to this locale. Returns whether the locale changed.
   */
  observeContentLocale(locale: string): boolean
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
  let actionSeq = 0
  let action: PendingActionRestore | null = null
  let observedLocale: string | null = null

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  /**
   * Clears what belongs to one content locale's text. A rich-text selection,
   * once recorded, is cleared here too: a caret position recorded in one
   * language is never replayed in another.
   */
  const clearLocaleBoundState = () => {
    target = null
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
      action = null
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
    setActionRestore(input, onSeq) {
      actionSeq += 1
      // A newer action supersedes a save that has not been restored yet.
      pending = null
      current = null
      action = { ...input, actionSeq, target: target ? { ...target } : null }
      // The caller learns the identity before any subscriber can consume it.
      onSeq?.(actionSeq)
      notify()
      return actionSeq
    },
    takeActionRestore(rendered) {
      if (!action) return null
      if (action.toLocale !== null && rendered.locale !== action.toLocale) return null
      if (
        action.expectedRevision !== null &&
        (rendered.revision === undefined || rendered.revision < action.expectedRevision)
      ) {
        return null
      }
      const result = action
      action = null
      if (result.toLocale !== null && result.toLocale !== result.fromLocale) {
        clearLocaleBoundState()
        result.target = null
      }
      return result
    },
    observeContentLocale(locale) {
      const changed = observedLocale !== null && observedLocale !== locale
      observedLocale = locale
      if (!changed) return false
      clearLocaleBoundState()
      pending = null
      current = null
      // The locale transition's own intent (its anchor and selector) is kept.
      if (action && action.toLocale !== locale) action = null
      return true
    },
    cancelPendingRestore() {
      const hadPending = pending !== null || action !== null
      pending = null
      current = null
      action = null
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
