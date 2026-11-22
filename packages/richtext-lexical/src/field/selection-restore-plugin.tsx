'use client'

/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'

import type { RichTextSelectionMemory, StructuralSelection } from '@byline/admin/react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical'

import { APPLY_VALUE_TAG, SELECTION_RESTORE_TAG } from './constants'
import { contentFingerprint } from './content-fingerprint'
import type { BaselineSignal } from './baseline-signal'

type StructuralPoint = StructuralSelection['anchor']

/** Child indexes from the root down to `node`; `null` when it is detached. */
function $pathOf(node: LexicalNode): number[] | null {
  const path: number[] = []
  let current: LexicalNode | null = node
  while (current != null && !$isRootNode(current)) {
    path.unshift(current.getIndexWithinParent())
    current = current.getParent()
  }
  return current == null ? null : path
}

function $structuralPoint(point: PointType): StructuralPoint | null {
  const path = $pathOf(point.getNode())
  return path == null ? null : { path, offset: point.offset }
}

/** The node and point type at a structural point, or `null` when it no longer fits. */
function $resolvePoint(
  point: StructuralPoint
): { key: string; offset: number; type: 'text' | 'element' } | null {
  let node: LexicalNode = $getRoot()
  for (const index of point.path) {
    if (!$isElementNode(node)) return null
    const child = node.getChildAtIndex(index)
    if (child == null) return null
    node = child
  }
  if (point.offset < 0) return null
  if ($isTextNode(node)) {
    if (point.offset > node.getTextContentSize()) return null
    return { key: node.getKey(), offset: point.offset, type: 'text' }
  }
  if ($isElementNode(node)) {
    if (point.offset > node.getChildrenSize()) return null
    return { key: node.getKey(), offset: point.offset, type: 'element' }
  }
  return null
}

/**
 * The fingerprint of the content the editor holds, as a save stores it
 * (`contentFingerprint`). Computed once when a save begins and once when
 * the restoration compares, never per caret move.
 */
function editorFingerprint(editor: LexicalEditor): string {
  return contentFingerprint(editor.getEditorState().toJSON())
}

/** Edits that originate inside the root's DOM but outside its own content. */
const NESTED_EDIT_EVENTS = ['beforeinput', 'input', 'paste', 'cut', 'drop'] as const

/**
 * Records the root editor's selection while its field is the working
 * target, and puts it back after a successful save. Mounted in the field's
 * root editor only, and only when the form has a visit store, so nested
 * editors (image captions, admonition bodies) and untracked forms never
 * record.
 *
 * Recording reads the selection's structural points only, deferred to a
 * microtask so the form has recorded the working target from the same
 * input event, and only while the root's own content-editable holds focus.
 * The content fingerprint is computed on demand when a save begins. An edit
 * inside a nested editor, or a non-range root selection (a selected image),
 * clears the recorded selection. Unmounting releases this editor's live
 * selection from the visit store, which outlives it.
 *
 * Restoring is a rendezvous between two conditions that may arrive in
 * either order: `ApplyValuePlugin` has established the baseline for the
 * value the editor holds (tracked by `baseline`, and reset whenever a
 * different, refused or null value arrives), and the current successful
 * save's restoration has handed on a selection (`memory`). The selection is
 * taken once, when both hold. The caret is placed only when the value was
 * not adapted, the content fingerprint matches (only server-refreshed embed
 * metadata may differ), both points resolve, and
 * the control restoration focused still holds focus. The update is
 * selection-only and runs outside any other update, so it never reaches the
 * form's `onChange`.
 */
export function SelectionRestorePlugin({
  memory,
  baseline,
}: {
  memory: RichTextSelectionMemory
  baseline: BaselineSignal
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    let disposed = false
    let scheduled = false
    // Identifies this editor instance's recordings, so its teardown releases
    // only what it recorded, never a newer instance's selection.
    const owner = {}
    // Never serializes a torn-down editor, even if a save begins before the
    // release below has run.
    const fingerprint = () => (disposed ? null : editorFingerprint(editor))

    const record = () => {
      scheduled = false
      if (disposed) return
      const rootElement = editor.getRootElement()
      const selection = editor.getEditorState().read(() => {
        const current = $getSelection()
        if (current == null) return undefined
        if (!$isRangeSelection(current)) return null
        const anchor = $structuralPoint(current.anchor)
        const focus = $structuralPoint(current.focus)
        return anchor && focus ? { anchor, focus } : undefined
      })
      // A selected image or table cells: an older caret must not survive it.
      if (selection === null) {
        memory.clear()
        return
      }
      if (rootElement == null || rootElement.ownerDocument.activeElement !== rootElement) return
      if (selection !== undefined) memory.record(selection, fingerprint, owner)
    }

    const unregisterUpdates = editor.registerUpdateListener(({ tags }) => {
      if (tags.has(APPLY_VALUE_TAG) || scheduled) return
      scheduled = true
      queueMicrotask(record)
    })

    // An edit belongs to a nested editor (or a control inside a decorator)
    // when its nearest editing boundary is not the root itself. A paste can
    // target a text span inside the root; that is still a root edit.
    const onNestedEdit = (event: Event) => {
      const target = event.target as Node | null
      const element = target instanceof Element ? target : (target?.parentElement ?? null)
      if (element?.closest('[contenteditable]') !== editor.getRootElement()) memory.clear()
    }
    const unregisterRoot = editor.registerRootListener((rootElement, previous) => {
      for (const type of NESTED_EDIT_EVENTS) {
        previous?.removeEventListener(type, onNestedEdit, true)
        rootElement?.addEventListener(type, onNestedEdit, true)
      }
    })

    return () => {
      disposed = true
      unregisterUpdates()
      unregisterRoot()
      // The visit store outlives this editor: drop its live selection, and
      // with it the closure over the editor. A selection a save has already
      // snapshotted is kept for the editor that replaces this one.
      memory.release(owner)
    }
  }, [editor, memory])

  useEffect(() => {
    let disposed = false

    const reconcile = () => {
      if (disposed) return
      const status = baseline.status()
      // Without a baseline for the value the editor holds, a grant waits.
      if (status == null) return
      // Taken once, here: an adapted value spends the grant without a caret.
      const taken = memory.take()
      if (taken == null || status !== 'ok' || !editor.isEditable()) return
      const rootElement = editor.getRootElement()
      if (rootElement == null) return
      if (editorFingerprint(editor) !== taken.fingerprint) return

      const points = editor.getEditorState().read(() => {
        const anchor = $resolvePoint(taken.sel.anchor)
        const focus = $resolvePoint(taken.sel.focus)
        return anchor && focus ? { anchor, focus } : null
      })
      if (points == null) return

      // Focus first, so the browser's own caret placement on focus is
      // superseded by the selection set synchronously below.
      rootElement.focus({ preventScroll: true })
      editor.update(
        () => {
          const selection = $createRangeSelection()
          selection.anchor.set(points.anchor.key, points.anchor.offset, points.anchor.type)
          selection.focus.set(points.focus.key, points.focus.offset, points.focus.type)
          $setSelection(selection)
        },
        // Restoration has already re-anchored the scroll position.
        { discrete: true, tag: [SELECTION_RESTORE_TAG, SKIP_SCROLL_INTO_VIEW_TAG] }
      )
    }

    // A baseline is signalled from a frame or a layout effect, outside any
    // editor update. Store notifications can come from anywhere, so they
    // are reconciled on a microtask.
    const unsubscribeBaseline = baseline.subscribe(reconcile)
    const unsubscribeMemory = memory.subscribe(() => queueMicrotask(reconcile))
    return () => {
      disposed = true
      unsubscribeBaseline()
      unsubscribeMemory()
    }
  }, [baseline, editor, memory])

  return null
}
