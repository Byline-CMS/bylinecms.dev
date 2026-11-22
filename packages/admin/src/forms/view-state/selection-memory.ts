/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo } from 'react'

import { useEditorViewState } from './editor-view-state-context'
import type { EditorViewStateStore, StructuralSelection } from './editor-view-state'

/**
 * How long a granted selection may wait for its editor. A rich-text editor
 * places the caret only once its baseline for the reloaded value is
 * established; past this bound the field's focus stands.
 */
const SELECTION_WINDOW_MS = 1000

/** Any of these ends a granted selection: the editor has moved on. */
const MOVE_ON_EVENTS = ['focusin', 'keydown', 'pointerdown'] as const

type TextControl = HTMLInputElement | HTMLTextAreaElement

/**
 * The control's selection offsets, or `null` when it has none. Number, date,
 * email and similar inputs report `null` (or throw) and are never recorded
 * or restored.
 */
function selectionOf(control: TextControl): { start: number; end: number } | null {
  try {
    const { selectionStart: start, selectionEnd: end } = control
    return typeof start === 'number' && typeof end === 'number' ? { start, end } : null
  } catch {
    return null
  }
}

function isTextControl(element: unknown): element is TextControl {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}

/**
 * A short fingerprint of a plain control's value (its length and an FNV-1a
 * hash). The store keeps this, never the value itself.
 */
function fingerprintText(value: string): string {
  let hash = 2166136261 >>> 0
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`
}

/**
 * Records the caret or selection of a plain input or textarea in the field
 * at `path`. Read-only: it touches neither the control nor form state. The
 * store ignores it unless `path` is the working target. The value's
 * fingerprint is taken only if a save begins.
 */
export function recordTextSelection(
  store: EditorViewStateStore,
  path: string,
  element: Element
): void {
  if (!isTextControl(element)) return
  const range = selectionOf(element)
  if (range == null) return
  const direction = element.selectionDirection
  store.setSelection(path, {
    kind: 'text',
    ...range,
    direction: direction === 'forward' || direction === 'backward' ? direction : 'none',
    fingerprint: () => fingerprintText(element.value),
  })
}

/** The control each live rich-text grant was handed to, by store. */
const grantHolders = new WeakMap<EditorViewStateStore, { grantId: number; control: Element }>()

/**
 * Hands a granted selection to the restored control. A plain input or
 * textarea gets its caret back at once, and only while its value still has
 * the recorded fingerprint. A rich-text field's wrapper leaves the selection
 * to its editor, which takes it once its baseline is ready and only while
 * the wrapper itself still holds focus; the grant ends when the editor moves
 * on or after `SELECTION_WINDOW_MS`.
 */
export function replaySelection(
  store: EditorViewStateStore,
  saveSeq: number,
  path: string,
  control: HTMLElement
): void {
  const grantId = store.grantSelection(saveSeq, path)
  if (grantId == null) return
  if (isTextControl(control)) {
    const record = store.takeSelection(path)
    if (record?.kind !== 'text' || selectionOf(control) == null) return
    if (fingerprintText(control.value) !== record.fingerprint) return
    try {
      control.setSelectionRange(record.start, record.end, record.direction)
    } catch {
      // The control stopped supporting selection; its focus stands.
    }
    return
  }
  grantHolders.set(store, { grantId, control })
  openSelectionWindow(store, grantId)
}

function openSelectionWindow(store: EditorViewStateStore, grantId: number): void {
  if (typeof document === 'undefined') return
  const close = () => {
    for (const type of MOVE_ON_EVENTS) document.removeEventListener(type, close, true)
    clearTimeout(timer)
    store.revokeSelection(grantId)
    if (grantHolders.get(store)?.grantId === grantId) grantHolders.delete(store)
  }
  for (const type of MOVE_ON_EVENTS) document.addEventListener(type, close, true)
  const timer = setTimeout(close, SELECTION_WINDOW_MS)
}

export interface RichTextSelectionMemory {
  /**
   * Records the root editor's selection. `fingerprint` describes the content
   * the selection belongs to; it is called only if a save begins, so a caret
   * move costs no serialization.
   */
  record(sel: StructuralSelection, fingerprint: () => string | null): void
  /** Drops the recorded selection (a nested edit, a non-range selection). */
  clear(): void
  /**
   * The selection to replay, once, while the restoration of the current
   * successful save is handing it on and the control it focused still holds
   * focus; `null` at any other time. `fingerprint` is the content's at save.
   */
  take(): { sel: StructuralSelection; fingerprint: string } | null
  /** Notified when a selection may have become available to `take()`. */
  subscribe(listener: () => void): () => void
}

/**
 * The selection memory of the rich-text field at `path`, for its root
 * editor only, or `null` without a visit store, so an untracked form does
 * no selection work at all. Recording is active only while `path` is the
 * working target; `take()` returns a selection only while the restoration
 * of the current successful save authorizes it.
 */
export function useRichTextSelectionMemory(path: string): RichTextSelectionMemory | null {
  const store = useEditorViewState()
  return useMemo(() => {
    if (store == null) return null
    return {
      record(sel, fingerprint) {
        store.setSelection(path, { kind: 'richText', sel, fingerprint })
      },
      clear() {
        store.clearSelection(path)
      },
      take() {
        const holder = grantHolders.get(store)
        const record = store.takeSelection(path)
        if (record?.kind !== 'richText' || holder == null) return null
        grantHolders.delete(store)
        // Exactly the control restoration focused: not <body> after a blur,
        // not some other focusable ancestor.
        if (holder.control.ownerDocument.activeElement !== holder.control) return null
        return { sel: record.sel, fingerprint: record.fingerprint }
      },
      subscribe: (listener) => store.subscribe(listener),
    }
  }, [path, store])
}
