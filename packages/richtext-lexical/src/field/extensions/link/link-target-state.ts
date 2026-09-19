/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The state machine behind "where does this link point?" — shared by the
 * link modal and the inline-image modal so both offer the same choice of
 * a Byline document or an arbitrary URL, with the same validation.
 *
 * React-free on purpose. The JSX shell lives in `link-target-fields.tsx`;
 * everything that decides anything lives here, where it can be tested
 * without a DOM.
 *
 * The one asymmetry between callers is `allowNone`. A `LinkNode` exists
 * only because it has a target, so its form always resolves to a link. An
 * inline image's target is optional, so its form adds a "no link" choice
 * and `toLinkAttributes` may return `undefined` — which is precisely how
 * an editor removes a link that is already there.
 */

import type { MultiCollectionDefinition } from '@byline/core'

import { validateUrl } from '../../utils/url'
import type { DocumentRelation } from '../../nodes/document-relation'
import type { LinkAttributes } from '.'

export interface LinkTargetState {
  /** Narrow with `LinkTargetState['kind']` rather than a separate alias. */
  kind: 'none' | 'custom' | 'internal'
  /** Custom-URL text. Meaningful only when `kind === 'custom'`. */
  url: string
  newTab: boolean
  /**
   * Which collection the picker is currently pointed at — UI state only,
   * and deliberately independent of `picked.targetCollectionPath` so the
   * user can browse other collections without losing their selection.
   */
  targetCollection: string | null
  /** The chosen document. Meaningful only when `kind === 'internal'`. */
  picked: DocumentRelation | null
}

export interface LinkTargetOptions {
  /** Whether "no link at all" is a valid outcome. */
  allowNone: boolean
}

/**
 * A link the toolbar inserted as a placeholder, before the editor has
 * chosen anything. Shown as an empty form rather than a URL box pre-filled
 * with `https://`.
 */
function isPlaceholderUrl(url: string | undefined): boolean {
  return url == null || url === '' || url === 'https://'
}

/**
 * The starting state for a form with nothing chosen yet. Module-private:
 * `fromLinkAttributes(undefined, …)` returns exactly this, so callers have
 * one way in rather than two that must agree.
 */
function emptyLinkTargetState(
  linkable: MultiCollectionDefinition[],
  options: LinkTargetOptions
): LinkTargetState {
  const firstLinkable = linkable[0]?.path ?? null
  const kind: LinkTargetState['kind'] = options.allowNone
    ? 'none'
    : linkable.length > 0
      ? 'internal'
      : 'custom'
  return {
    kind,
    url: '',
    newTab: false,
    targetCollection: firstLinkable,
    picked: null,
  }
}

export function fromLinkAttributes(
  link: LinkAttributes | undefined,
  linkable: MultiCollectionDefinition[],
  options: LinkTargetOptions
): LinkTargetState {
  const base = emptyLinkTargetState(linkable, options)
  if (link == null) return base

  if (link.linkType === 'internal') {
    const picked: DocumentRelation = {
      targetDocumentId: link.targetDocumentId,
      targetCollectionId: link.targetCollectionId,
      targetCollectionPath: link.targetCollectionPath,
      document: link.document,
    }
    return {
      ...base,
      kind: 'internal',
      newTab: link.newTab ?? false,
      targetCollection: picked.targetCollectionPath || base.targetCollection,
      picked,
    }
  }

  // Custom. An undecided placeholder prefers the document picker when any
  // collection offers one; otherwise it stays on the (empty) URL field.
  const placeholder = isPlaceholderUrl(link.url)
  const kind: LinkTargetState['kind'] = placeholder && linkable.length > 0 ? 'internal' : 'custom'
  return {
    ...base,
    kind,
    url: placeholder ? '' : (link.url ?? ''),
    newTab: link.newTab ?? false,
  }
}

/**
 * Collapse the form back to a `LinkAttributes`, or `undefined` when there
 * is no usable target. Callers that require a link should run
 * `validateLinkTarget` first — this function reports "nothing to store"
 * rather than "the user made a mistake".
 */
export function toLinkAttributes(state: LinkTargetState): LinkAttributes | undefined {
  if (state.kind === 'none') return undefined
  if (state.kind === 'internal') {
    if (state.picked == null) return undefined
    return {
      linkType: 'internal',
      newTab: state.newTab,
      targetDocumentId: state.picked.targetDocumentId,
      targetCollectionId: state.picked.targetCollectionId,
      targetCollectionPath: state.picked.targetCollectionPath,
      document: state.picked.document,
    }
  }
  if (state.url.length === 0) return undefined
  return { linkType: 'custom', url: state.url, newTab: state.newTab }
}

/** Returns a human-readable problem, or `null` when the form is usable. */
export function validateLinkTarget(state: LinkTargetState): string | null {
  if (state.kind === 'none') return null
  if (state.kind === 'internal') {
    return state.picked == null ? 'Pick a target document' : null
  }
  if (state.url.length === 0) {
    return 'Enter a URL or a root-relative path starting with /'
  }
  // Root-relative paths bypass `validateUrl`, which expects a scheme.
  if (!state.url.startsWith('/') && !validateUrl(state.url)) {
    return 'Enter a valid URL or a root-relative path starting with /'
  }
  return null
}
