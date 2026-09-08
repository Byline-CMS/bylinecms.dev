/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Server-owned classification. A browser header cannot opt a request into SSR privileges. */
const key = Symbol.for('byline.sessionRequestKinds')
const kinds: WeakMap<object, string> = (globalThis as any)[key] ?? new WeakMap()
;(globalThis as any)[key] = kinds
export function recordSessionRequestKind(request: object, kind: string) {
  kinds.set(request, kind)
}
export function sessionRequestKind(request: object) {
  return kinds.get(request)
}
