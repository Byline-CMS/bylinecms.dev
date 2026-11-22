/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type RefObject, useCallback, useContext, useEffect } from 'react'

import { useEditorViewState } from './editor-view-state-context'
import type { EditorViewStateStore, TargetRole } from './editor-view-state'

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

/** The first marker in `root` with exactly this address and role. */
export function findMarker(root: ParentNode, path: string, role: string): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(`[${TARGET_ATTR}]`)) {
    if (element.getAttribute(TARGET_ATTR) === path && element.getAttribute(ROLE_ATTR) === role) {
      return element
    }
  }
  return null
}

/** Records the closest marker of `element` as the working target. Returns whether one was found. */
export function recordTargetFromElement(store: EditorViewStateStore, element: Element): boolean {
  const marker = element.closest(`[${TARGET_ATTR}]`)
  const path = marker?.getAttribute(TARGET_ATTR)
  const role = marker?.getAttribute(ROLE_ATTR) as TargetRole | null | undefined
  if (marker == null || !path || !role) return false
  store.setTarget({ path, role, offset: marker.getBoundingClientRect().top })
  return true
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
  store.setTarget({ path, role, offset: marker ? marker.getBoundingClientRect().top : null })
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
 * Records the working target from DOM edit events inside the form: the
 * closest marker of the element that changed. Focus alone never records, and
 * edits inside a `TRANSIENT_ATTR` surface never record. A no-op without a
 * visit store.
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
      recordTargetFromElement(store, element)
    }
    for (const type of EDIT_EVENTS) form.addEventListener(type, onEdit)
    return () => {
      for (const type of EDIT_EVENTS) form.removeEventListener(type, onEdit)
    }
  }, [formRef, store])
}
