/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type RefObject, useCallback, useContext, useEffect } from 'react'

import { useEditorViewState } from './editor-view-state-context'
import { recordTextSelection } from './selection-memory'
import { type AnchorCandidate, pickViewAnchor } from './view-anchor'
import { isTrustedAddress } from './view-state-address'
import type { ActionRole, EditorViewStateStore, TargetRole, ViewAnchor } from './editor-view-state'

/**
 * DOM markers that tie an element to a working-target address.
 *
 * A field widget puts `targetMarker(path, 'field')` on its root element, and
 * an item header puts `grip`, `toggle` and `menu` markers on its controls.
 * Recording reads the closest marker of the element that changed; restoration
 * looks the marker up again in the remounted form.
 */
export const TARGET_ATTR = 'data-byline-target'
const ROLE_ATTR = 'data-byline-role'

/**
 * Marks an auxiliary surface inside a field (a search box, a filter) whose
 * native edit events change no field value. Edits inside it never record.
 */
const TRANSIENT_ATTR = 'data-byline-transient'

/**
 * Names the declared input id of a custom field slot (`components.Field`).
 * Restoration focuses the element with that id inside the field's own marker
 * in preference to DOM order, so a slot whose filter box comes before its
 * value control still restores to the value control.
 */
export const CONTROL_ID_ATTR = 'data-byline-control-id'

/**
 * The owning form element. Marker lookups are scoped to it, because two
 * mounted forms can carry identical addresses.
 */
export const TargetFormContext = createContext<RefObject<HTMLFormElement | null> | null>(null)

/** The owning form element, or `null` outside a form. Read at call time. */
export function useTargetForm(): () => HTMLFormElement | null {
  const formRef = useContext(TargetFormContext)
  return useCallback(() => formRef?.current ?? null, [formRef])
}

/** Reserved addresses for the sidebar document controls, which are not schema fields. */
export const SYSTEM_TARGETS = {
  path: '$path',
  availableLocales: '$availableLocales',
  treePlacement: '$treePlacement',
  /** Document action controls (status, locale selector); never a working target. */
  document: '$document',
} as const

export function targetMarker(
  path: string,
  role: TargetRole
): { 'data-byline-target': string; 'data-byline-role': TargetRole } {
  return { [TARGET_ATTR]: path, [ROLE_ATTR]: role } as {
    'data-byline-target': string
    'data-byline-role': TargetRole
  }
}

/**
 * Marks a document action control (the status control, the locale selector),
 * so the restoration after its navigation can focus it again.
 */
export function documentActionMarker(role: ActionRole): {
  'data-byline-target': string
  'data-byline-role': TargetRole
} {
  return targetMarker(SYSTEM_TARGETS.document, role)
}

/** The first marker in `root` with exactly this address and role. */
export function findMarker(root: ParentNode, path: string, role: string): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(`[${TARGET_ATTR}]`)) {
    if (element.getAttribute(TARGET_ATTR) === path && element.getAttribute(ROLE_ATTR) === role) {
      return element
    }
  }
  return null
}

/** A rect's signed viewport offset, and whether any part of it was inside the viewport. */
export function viewportPlacement(rect: DOMRect): { offset: number; intersecting: boolean } {
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  return {
    offset: rect.top,
    intersecting: rect.top < viewportHeight && rect.bottom > 0,
  }
}

/** Records the closest marker of `element` as the working target. Returns whether one was found. */
export function recordTargetFromElement(store: EditorViewStateStore, element: Element): boolean {
  const marker = element.closest(`[${TARGET_ATTR}]`)
  const path = marker?.getAttribute(TARGET_ATTR)
  const role = marker?.getAttribute(ROLE_ATTR) as TargetRole | null | undefined
  if (marker == null || !path || !role || path === SYSTEM_TARGETS.document) return false
  store.setTarget({ path, role, ...viewportPlacement(marker.getBoundingClientRect()) })
  return true
}

/**
 * The marker that keeps the scroll position across a navigation, with its
 * signed viewport offset (`pickViewAnchor`). Document action markers,
 * positional addresses, zero-size markers and markers inside hidden content
 * are skipped: none of them can be found again reliably.
 */
export function topmostVisibleAnchor(form: ParentNode): ViewAnchor | null {
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const candidates: AnchorCandidate[] = []
  for (const element of form.querySelectorAll<HTMLElement>(`[${TARGET_ATTR}]`)) {
    const path = element.getAttribute(TARGET_ATTR)
    const role = element.getAttribute(ROLE_ATTR) as TargetRole | null
    if (!path || !role || path === SYSTEM_TARGETS.document || !isTrustedAddress(path)) continue
    if (element.closest('[hidden], [inert], .byline-sortable-content-hidden')) continue
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    let depth = 0
    for (let up = element.parentElement?.closest(`[${TARGET_ATTR}]`); up; ) {
      depth++
      up = up.parentElement?.closest(`[${TARGET_ATTR}]`)
    }
    candidates.push({ path, role, top: rect.top, bottom: rect.bottom, depth })
  }
  return pickViewAnchor(candidates, viewportHeight)
}

/**
 * Records the caret of a plain input or textarea inside a field marker
 * (`recordTextSelection`). Rich-text editors record their own selection.
 */
function recordCaretFromElement(store: EditorViewStateStore, element: Element): void {
  const marker = element.closest(`[${TARGET_ATTR}]`)
  const path = marker?.getAttribute(TARGET_ATTR)
  if (!path || marker?.getAttribute(ROLE_ATTR) !== 'field') return
  recordTextSelection(store, path, element)
}

/**
 * Records an address explicitly, for changes that raise no DOM `input` or
 * `change` event (pickers, uploads, structural actions). The offset comes
 * from the marker in `form` when it is rendered there, and is `null`
 * otherwise.
 */
function recordTarget(
  store: EditorViewStateStore,
  path: string,
  role: TargetRole,
  form: ParentNode | null
): void {
  const marker = form ? findMarker(form, path, role) : null
  store.setTarget({
    path,
    role,
    ...(marker ? viewportPlacement(marker.getBoundingClientRect()) : { offset: null }),
  })
}

/** `recordTarget` bound to the surrounding form and its store; a no-op without a store. */
export function useRecordTarget(): (path: string, role: TargetRole) => void {
  const store = useEditorViewState()
  const getForm = useTargetForm()
  return useCallback(
    (path: string, role: TargetRole) => {
      if (store) recordTarget(store, path, role, getForm())
    },
    [getForm, store]
  )
}

/**
 * `beforeinput` covers content-editable editors (Lexical) that cancel the
 * native edit and apply it themselves, so no `input` event follows.
 */
const EDIT_EVENTS = ['input', 'change', 'beforeinput'] as const

/**
 * Events after which a plain input's or textarea's caret may have moved
 * without an edit: a selection, a key (arrows, Home, End), a pointer.
 */
const CARET_EVENTS = ['select', 'keyup', 'pointerup'] as const

/**
 * Records the working target from DOM edit events inside the form: the
 * closest marker of the element that changed. Focus alone never records, and
 * edits inside a `TRANSIENT_ATTR` surface never record. A no-op without a
 * visit store.
 *
 * It also records the caret of the working target's plain input or
 * textarea, after an edit and after `CARET_EVENTS`. That is read-only view
 * state; rich-text editors record their own selection.
 *
 * Widgets whose edits raise no native event (pickers, uploads, structural
 * actions) record from their own change handlers inside `@byline/admin`. A
 * custom `components.Field` slot for text, textArea or numerical sits in a
 * transient wrapper, so its native events (a local filter box, say) are
 * ignored here; the widget records when the slot reports a value through the
 * `onChange` callback it was given.
 */
export function useRecordEditTargets(formRef: RefObject<HTMLFormElement | null>): void {
  const store = useEditorViewState()
  useEffect(() => {
    const form = formRef.current
    if (store == null || form == null) return
    const onEdit = (event: Event) => {
      const element = event.target
      if (!(element instanceof Element) || element.closest(`[${TRANSIENT_ATTR}]`)) return
      // Recording a target clears the previous selection, so the caret is
      // recorded after it.
      if (recordTargetFromElement(store, element)) recordCaretFromElement(store, element)
    }
    const onCaret = (event: Event) => {
      const element = event.target
      if (!(element instanceof Element) || element.closest(`[${TRANSIENT_ATTR}]`)) return
      recordCaretFromElement(store, element)
    }
    for (const type of EDIT_EVENTS) form.addEventListener(type, onEdit)
    for (const type of CARET_EVENTS) form.addEventListener(type, onCaret)
    return () => {
      for (const type of EDIT_EVENTS) form.removeEventListener(type, onEdit)
      for (const type of CARET_EVENTS) form.removeEventListener(type, onCaret)
    }
  }, [formRef, store])
}
