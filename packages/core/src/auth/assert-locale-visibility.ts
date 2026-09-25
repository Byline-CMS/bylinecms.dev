/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_UNAUTHENTICATED, type RequestContext } from '@byline/auth'

import { ERR_VALIDATION } from '../lib/errors.js'
import type { LocaleVisibility } from '../@types/index.js'

/**
 * Authorize a read's locale visibility, alongside `assertActorCanPerform`.
 * Called by `@byline/client` read methods after the collection read check and
 * before any DB work.
 *
 *   1. **`'editorial'` requires an actor.** Editorial visibility can deliver a
 *      complete but unchecked translation, so an anonymous caller is rejected
 *      with `ERR_UNAUTHENTICATED` even when `readMode === 'published'`. The
 *      actor's collection read ability is asserted by `assertActorCanPerform`.
 *   2. **`'public'` rejects `locale: 'all'`.** The multi-locale map would expose
 *      every stored translation, withheld or partial, so a public read must
 *      name one locale. This applies to every collection, including those
 *      without `advertiseLocales`.
 *
 * Locale visibility is read intent, not authority: nothing here elevates a
 * context, and `_bypassBeforeRead` has no bearing on it.
 */
export function assertLocaleVisibility(
  context: RequestContext | undefined,
  collectionPath: string,
  visibility: LocaleVisibility,
  locale: string | undefined
): void {
  if (visibility === 'editorial') {
    if (context?.actor == null) {
      throw ERR_UNAUTHENTICATED({
        message: `anonymous read of '${collectionPath}' cannot use localeVisibility: 'editorial'`,
      })
    }
    return
  }
  if (locale === 'all') {
    throw ERR_VALIDATION({
      message:
        `locale: 'all' is an editorial read on '${collectionPath}'; ` +
        `a public read must request a single locale`,
      details: { collectionPath },
    })
  }
}
