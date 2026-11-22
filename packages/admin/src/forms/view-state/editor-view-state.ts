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

/** A caret or selection point in a rich-text root editor. */
interface StructuralPoint {
  /** Child indexes from the editor root down to the point's node. Never node keys. */
  path: number[]
  /** A text offset in a text node, or a child index in an element node. */
  offset: number
}

/**
 * A rich-text root editor's selection, recorded structurally. Lexical node
 * keys change when the document reloads, so a point is addressed by its
 * child-index path from the root instead.
 */
export type StructuralSelection = { anchor: StructuralPoint; focus: StructuralPoint }

type SelectionRange =
  | { kind: 'richText'; sel: StructuralSelection }
  | { kind: 'text'; start: number; end: number; direction: 'forward' | 'backward' | 'none' }

/**
 * The caret or selection last recorded for the working target. Its content
 * fingerprint is computed on demand, once, when a save begins: recording a
 * caret move costs no serialization, and the store never holds field values.
 * `null` means the content cannot be fingerprinted (the control is gone).
 */
type LiveSelection = SelectionRange & { fingerprint: () => string | null }

/**
 * A selection as a save restoration replays it, with the fingerprint of the
 * content the save started from. A rich-text selection is replayed only into
 * structurally identical content, a plain control's only while its value
 * still has this fingerprint.
 */
type RecordedSelection = SelectionRange & { fingerprint: string }

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
  /**
   * Records the caret or selection of `path`, ignored unless `path` is the
   * working target. Read-only view state: it never notifies. Moving the
   * working target to another path or role clears it; recording the same
   * target again (a delayed change callback from the same edit) keeps it.
   */
  setSelection(path: string, selection: LiveSelection): void
  /**
   * Drops the recorded selection of `path`: a nested editor was edited, or
   * the root editor moved to a selection that cannot be recorded.
   */
  clearSelection(path: string): void
  /**
   * Lets the restoration of save `saveSeq`, having focused the exact control
   * for `path`, hand on the selection that was current when the save began.
   * Returns the grant's id, or `null` when there is nothing to replay.
   * Subscribers are notified on a later microtask, so an editor that is
   * already waiting can take the selection outside the restoration's own
   * call stack.
   */
  grantSelection(saveSeq: number, path: string): number | null
  /**
   * Returns the granted selection for `path` once. Without a live grant (no
   * successful save is being restored, the editor moved on, a newer save or
   * navigation began) it returns `null`.
   */
  takeSelection(path: string): RecordedSelection | null
  /** Ends grant `grantId` (its window expired, or the editor moved on). */
  revokeSelection(grantId: number): void
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
  // The working target's latest caret or selection.
  let selection: { path: string; record: LiveSelection } | null = null
  // The selection current when the latest save began.
  let saveSelection: { saveSeq: number; path: string; record: RecordedSelection } | null = null
  let grantSeq = 0
  // A save restoration's permission to replay `saveSelection`.
  let grant: { id: number; path: string; record: RecordedSelection } | null = null

  const dropSelectionReplay = () => {
    saveSelection = null
    grant = null
  }

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
    selection = null
    dropSelectionReplay()
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
      if (target?.path !== next.path || target.role !== next.role) selection = null
      target = next
      notify()
    },
    clearTarget() {
      target = null
      selection = null
      notify()
    },
    beginSave() {
      seq += 1
      pending = null
      action = null
      grant = null
      saveSelection = null
      if (selection && target && selection.path === target.path) {
        const { fingerprint, ...range } = selection.record
        let resolved: string | null = null
        try {
          resolved = fingerprint()
        } catch {
          resolved = null
        }
        if (resolved != null) {
          saveSelection = {
            saveSeq: seq,
            path: selection.path,
            record: { ...range, fingerprint: resolved } as RecordedSelection,
          }
        }
      }
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
      dropSelectionReplay()
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
    setSelection(path, record) {
      if (target?.path !== path) return
      selection = { path, record }
    },
    clearSelection(path) {
      if (selection?.path === path) selection = null
    },
    grantSelection(saveSeq, path) {
      if (saveSelection?.saveSeq !== saveSeq || saveSelection.path !== path) return null
      grantSeq += 1
      grant = { id: grantSeq, path, record: saveSelection.record }
      saveSelection = null
      queueMicrotask(notify)
      return grantSeq
    },
    takeSelection(path) {
      if (grant?.path !== path) return null
      const { record } = grant
      grant = null
      return record
    },
    revokeSelection(grantId) {
      if (grant?.id === grantId) grant = null
    },
    cancelPendingRestore() {
      const hadPending = pending !== null || action !== null
      pending = null
      current = null
      action = null
      dropSelectionReplay()
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
