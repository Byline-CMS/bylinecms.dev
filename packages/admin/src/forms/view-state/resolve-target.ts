/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type Field, formatInstancePath, parseInstancePath } from '@byline/core'

import { hasExistingIdTargets } from '../nested-path'
import { CONTROL_ID_ATTR, findMarker, TARGET_ATTR } from './target-markers'
import { trustedAddress } from './view-state-address'
import type { ViewTarget } from './editor-view-state'

/** Attribute on a tab set's container listing the schema fields its tabs hold. */
export const TABSET_FIELDS_ATTR = 'data-byline-tabset-fields'

const FOCUSABLE =
  'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex], [contenteditable="true"], [contenteditable=""]'

/**
 * A control is usable when it is connected, not disabled, not inside an
 * `inert` or hidden subtree, and not inside a collapsed item's hidden content.
 */
export function isUsable(element: Element): element is HTMLElement {
  if (!element.isConnected) return false
  if (typeof (element as HTMLElement).focus !== 'function') return false
  if (element.matches(':disabled, [aria-disabled="true"]')) return false
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false
  if (element.closest('.byline-sortable-content-hidden')) return false
  return true
}

/** Value-entry controls win over buttons inside one field (a path field's Regenerate button). */
const ENTRY_CONTROLS =
  'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [contenteditable=""]'

/**
 * Marks transient placeholder DOM, such as a lazily loaded editor's fallback.
 * A field whose control is still loading is "still mounting": it is never
 * focused, and restoration keeps waiting for the real control.
 */
const LOADING_ATTR = 'data-byline-loading'

function firstUsable(
  marker: Element,
  selector: string,
  accept: (candidate: Element) => boolean = () => true
): HTMLElement | null {
  for (const candidate of marker.querySelectorAll(selector)) {
    if (candidate.getAttribute('tabindex') === '-1') continue
    if (candidate.closest(`[${LOADING_ATTR}]`)) continue
    if (isUsable(candidate) && accept(candidate)) return candidate
  }
  return null
}

/**
 * The control a custom field slot declared through its input id
 * (`CONTROL_ID_ATTR`), looked up only inside this marker's own slot, not a
 * nested field's.
 */
function declaredControlWithin(marker: Element): HTMLElement | null {
  for (const holder of marker.querySelectorAll(`[${CONTROL_ID_ATTR}]`)) {
    if (holder.parentElement?.closest(`[${TARGET_ATTR}]`) !== marker) continue
    const id = holder.getAttribute(CONTROL_ID_ATTR)
    if (!id) continue
    for (const candidate of holder.querySelectorAll('[id]')) {
      if (candidate.id !== id) continue
      if (candidate.closest(`[${LOADING_ATTR}]`)) return null
      return isUsable(candidate) && candidate.matches(FOCUSABLE) ? candidate : null
    }
  }
  return null
}

/**
 * The exact control for a marker: the marker itself when it is focusable (a
 * rich-text field's `tabIndex={-1}` wrapper, an item header button),
 * otherwise a custom slot's declared input (`declaredControlWithin`),
 * otherwise its first usable value-entry control, otherwise its first usable
 * focusable descendant. The value-entry preference exists because the editor
 * changed the field's value, not, say, its Regenerate button.
 */
function exactControlWithin(marker: Element): HTMLElement | null {
  if (marker.matches(FOCUSABLE)) return isUsable(marker) ? marker : null
  return (
    declaredControlWithin(marker) ??
    firstUsable(marker, ENTRY_CONTROLS) ??
    firstUsable(marker, FOCUSABLE)
  )
}

/**
 * A containing field's own first focusable control. Controls inside the
 * field's repeating items belong to those items, not to the field: falling
 * back into one would put focus on a neighbour (spec §5.3), so a repeating
 * field resolves to its own add control instead.
 */
function ownControlWithin(marker: Element): HTMLElement | null {
  if (marker.matches(FOCUSABLE)) return isUsable(marker) ? marker : null
  return firstUsable(marker, FOCUSABLE, (candidate) => {
    const item = candidate.closest('.byline-sortable')
    return item == null || !marker.contains(item) || item === marker
  })
}

/** `path` and each shorter prefix, trimming one segment at a time. */
function addressChain(path: string): string[] {
  const parsed = parseInstancePath(path)
  if (!parsed.ok) return []
  const chain: string[] = []
  for (let length = parsed.segments.length; length > 0; length--) {
    chain.push(formatInstancePath(parsed.segments.slice(0, length)))
  }
  return chain
}

function topLevelName(path: string): string | null {
  const parsed = parseInstancePath(path)
  const first = parsed.ok ? parsed.segments[0] : undefined
  return first?.kind === 'field' ? first.name : null
}

/** The tab-set container that holds `fieldName`, when it sits in a tab set. */
function tabSetContaining(form: ParentNode, fieldName: string): HTMLElement | null {
  for (const container of form.querySelectorAll<HTMLElement>(`[${TABSET_FIELDS_ATTR}]`)) {
    const names = (container.getAttribute(TABSET_FIELDS_ATTR) ?? '').split(' ')
    if (names.includes(fieldName)) return container
  }
  return null
}

export function formHeading(form: ParentNode): HTMLElement | null {
  return form.querySelector<HTMLElement>('.byline-form-heading')
}

/**
 * The exact control for `target`, or `null` when it is not rendered or not
 * usable. A positional address is never exact: it is cut to its trusted
 * prefix first, and that prefix names a different, identifiable element.
 */
export function findExactControl(form: ParentNode, target: ViewTarget): HTMLElement | null {
  const trusted = trustedAddress(target.path)
  if (trusted === '' || trusted !== target.path) return null
  const marker = findMarker(form, trusted, target.role)
  return marker ? exactControlWithin(marker) : null
}

/**
 * Whether the exact control may still be mounting: its marker is absent, or
 * present and visible but with its control still loading (`LOADING_ATTR`) or
 * no focusable content rendered inside it yet. A marker that is rendered but hidden, collapsed,
 * inert or disabled is not mounting; restoration falls back at once.
 */
export function isExactControlPending(form: ParentNode, target: ViewTarget): boolean {
  const marker = findMarker(form, target.path, target.role)
  if (marker == null) return true
  if (!isUsable(marker)) return false
  if (marker.querySelector(`[${LOADING_ATTR}]`)) return true
  return !marker.matches(FOCUSABLE) && marker.querySelector(FOCUSABLE) == null
}

/**
 * Whether `target` is gone, or can never mount: its field is not in the
 * schema, sits under an unselected tab, or an item on its trusted path is no
 * longer in the form's data. Restoration then falls back without waiting.
 */
export function isTargetGone(
  form: ParentNode,
  target: ViewTarget,
  fields: readonly Field[],
  values: unknown
): boolean {
  const trusted = trustedAddress(target.path)
  const name = trusted === '' ? null : topLevelName(trusted)
  if (name == null) return true
  if (!fields.some((field) => 'name' in field && field.name === name)) return true
  // A field under an unselected tab is not rendered and will not be.
  if (tabSetContaining(form, name) && findMarker(form, name, 'field') == null) return true
  return !hasExistingIdTargets(values, trusted)
}

/**
 * Resolves a remembered target to the element restoration focuses. Applies
 * `trustedAddress`, then the first usable of:
 *
 *   1. the exact control
 *   2. the containing item's toggle, then its grip
 *   3. the containing field's first focusable control
 *   4. the active tab trigger, when the target sits under an unselected tab
 *   5. the form heading
 *
 * Levels 2 and 3 walk up by trimming the last path segment until a marker
 * matches. Restoration never changes a tab or collapse choice to reveal a
 * target; it only picks something already visible.
 */
export function resolveRestoreTarget(form: HTMLElement, target: ViewTarget): HTMLElement {
  const exact = findExactControl(form, target)
  if (exact) return exact

  const trusted = trustedAddress(target.path)
  const chain = trusted === '' ? [] : addressChain(trusted)

  for (const address of chain) {
    for (const role of ['toggle', 'grip'] as const) {
      const marker = findMarker(form, address, role)
      if (marker && isUsable(marker)) return marker
    }
  }

  for (const address of chain) {
    const marker = findMarker(form, address, 'field')
    const control = marker ? ownControlWithin(marker) : null
    if (control) return control
  }

  const name = trusted === '' ? null : topLevelName(trusted)
  if (name) {
    const container = tabSetContaining(form, name)
    const trigger = container?.querySelector('[role="tab"][aria-selected="true"]')
    if (trigger && isUsable(trigger)) return trigger
  }

  return formHeading(form) ?? form
}
