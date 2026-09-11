/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Translation keys for the node types a reader may be told about.
 *
 * Only types with NO declared conversion can reach a notice, which is
 * why this map is small: everything else is adapted silently.
 *
 * A type absent here falls back to its own id. That is deliberate — a
 * site or plugin contributing its own node should not have to supply a
 * display name to get a usable message, and reaching this path at all is
 * rare. The id is developer vocabulary, but it is accurate and
 * searchable, which beats inventing a label for a node Byline knows
 * nothing about.
 */
const CONTENT_LABEL_KEYS: Readonly<Record<string, string>> = {
  'inline-image': 'richtext.content.image',
  youtube: 'richtext.content.youtube',
  vimeo: 'richtext.content.vimeo',
}

export function contentLabelKey(type: string): string | undefined {
  return CONTENT_LABEL_KEYS[type]
}

/**
 * Join labels the way the active locale writes a list.
 *
 * `Intl.ListFormat` is not available in every runtime this may render
 * in, so fall back to a comma join rather than throwing over a notice.
 */
export function joinLabels(labels: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(labels)
  } catch {
    return labels.join(', ')
  }
}
