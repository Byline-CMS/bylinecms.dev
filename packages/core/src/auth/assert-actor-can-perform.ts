/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_UNAUTHENTICATED, type RequestContext } from '@byline/auth'

import {
  type DocumentAbilityResource,
  type DocumentAbilityVerbFor,
  documentAbilityKey,
} from './register-collection-abilities.js'

/**
 * Central enforcement helper. Called from the service layer — at the top
 * of each `document-lifecycle` function and at the top of each
 * `@byline/client.CollectionHandle` read method — before any DB work.
 *
 * Policy, in order:
 *
 *   1. **No `RequestContext`** → `ERR_UNAUTHENTICATED`. Every enforced
 *      call site must supply a context. Tests, seeds, and migration
 *      scripts pass `createSuperAdminContext()` from `@byline/auth` for
 *      this.
 *
 *   2. **`actor === null` (public / anonymous reader)**:
 *        - Only permitted on `verb === 'read'`.
 *        - Only when `readMode === 'published'` (the `@byline/client`
 *          default for unauthenticated consumers).
 *        - Any other combination → `ERR_UNAUTHENTICATED`.
 *
 *   3. **Actor present** → assert the kind-aware ability key derived from the
 *      resource descriptor.
 *      `AdminAuth` with `isSuperAdmin: true` short-circuits the check
 *      internally; any other actor must hold the specific ability.
 *
 * Direct adapter calls (`db.commands.*` / `db.queries.*`) intentionally
 * bypass this helper — the same escape hatch that skips collection
 * hooks. Seeds, migrations, and internal tooling live there.
 *
 * See docs/07-auth-and-security/01-authn-authz.md.
 */
export function assertActorCanPerform<Resource extends DocumentAbilityResource>(
  context: RequestContext | undefined,
  resource: Resource,
  verb: DocumentAbilityVerbFor<Resource>
): void {
  const path = resource.path
  if (!context) {
    throw ERR_UNAUTHENTICATED({
      message:
        `missing requestContext on ${verb} '${path}'. Pass createSuperAdminContext() ` +
        `from @byline/auth for scripts/tests, or construct a request-scoped context from your ` +
        `session provider in the admin webapp.`,
    })
  }

  const { actor, readMode } = context

  if (actor == null) {
    if (verb !== 'read') {
      throw ERR_UNAUTHENTICATED({
        message: `anonymous request cannot ${verb} '${path}': no actor in context`,
      })
    }
    if (readMode !== 'published') {
      throw ERR_UNAUTHENTICATED({
        message:
          `anonymous read of '${path}' requires readMode: 'published' ` +
          `(got readMode: ${readMode == null ? '<unset>' : `'${readMode}'`})`,
      })
    }
    // Anonymous read of published content — permitted.
    return
  }

  actor.assertAbility(documentAbilityKey(resource, verb))
}
