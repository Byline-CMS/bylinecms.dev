/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * A stored value's declaration path.
 *
 * Storage addresses a value by its instance path —
 * `content.1.photoBlock.caption`, carrying the item index — while the
 * capability manifest is keyed by declaration path. The two are one
 * grammar with two serialisations, and eliding the selectors from an
 * instance path yields the declaration path. Numeric segments are the
 * selectors.
 *
 * See docs/03-architecture/04-path-grammar.md.
 */
export function toDeclarationPath(instancePath: string): string {
  return instancePath
    .split('.')
    .filter((segment) => !/^\d+$/.test(segment))
    .join('.')
}
