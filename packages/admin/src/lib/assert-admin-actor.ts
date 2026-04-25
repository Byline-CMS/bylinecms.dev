/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type AdminAuth, ERR_UNAUTHENTICATED, isAdminAuth, type RequestContext } from '@byline/auth'

/**
 * Gate every admin command behind three checks, in order:
 *
 *   1. `context` exists. No in-process call may reach an admin command
 *      without threading a `RequestContext` — seeds/tests pass
 *      `createSuperAdminContext()`.
 *   2. `context.actor` is an `AdminAuth`. Anonymous admin calls are
 *      rejected outright — admin actions are never public. A `UserAuth`
 *      (end-user identity) also fails here: it may sign in against the
 *      app realm, but it does not have an admin identity.
 *   3. The actor holds the required ability. `AdminAuth.assertAbility`
 *      short-circuits on `isSuperAdmin: true`; otherwise the flat
 *      ability set is consulted.
 *
 * Returns the narrowed `AdminAuth` so callers can use it without a
 * second type guard — the typical shape is:
 *
 *   ```ts
 *   export async function deleteAdminUserCommand(context, input, deps) {
 *     const parsed = deleteAdminUserRequestSchema.parse(input)
 *     const actor = assertAdminActor(context, ADMIN_USERS_ABILITIES.delete)
 *     return service.deleteUser(actor, parsed)
 *   }
 *   ```
 *
 * The three failures produce distinct error codes:
 *   - missing context / missing actor / wrong actor type → `ERR_UNAUTHENTICATED`
 *   - ability missing                                    → `ERR_FORBIDDEN`
 *     (thrown from `AdminAuth.assertAbility`)
 */
export function assertAdminActor(context: RequestContext | undefined, ability: string): AdminAuth {
  const actor = requireAdminActor(context, `admin action requiring '${ability}'`)
  actor.assertAbility(ability)
  return actor
}

/**
 * Authentication-only counterpart of `assertAdminActor`. Runs the same
 * three checks (context present, actor present, actor is `AdminAuth`)
 * but **does not** assert any ability key.
 *
 * Used by self-service commands where the actor is the target by
 * definition — `@byline/admin/admin-account` for "change my own
 * password" / "update my own profile". For those flows there is no
 * meaningful ability to gate against; the security property is "you
 * may only mutate your own row," and the commands enforce that by
 * sourcing the target id from `actor.id` rather than from the
 * request payload.
 *
 * Reasoning is described as part of the request narrative so the
 * `ERR_UNAUTHENTICATED` message stays useful when it surfaces in logs
 * — the helper has no `ability` argument to fall back on.
 */
export function requireAdminActor(
  context: RequestContext | undefined,
  reasonForLog: string
): AdminAuth {
  if (!context) {
    throw ERR_UNAUTHENTICATED({
      message:
        `missing requestContext on ${reasonForLog}. Pass createSuperAdminContext() ` +
        `from @byline/auth for scripts/tests, or construct a request-scoped context from your ` +
        `session provider in the admin webapp.`,
    })
  }

  const { actor } = context
  if (actor == null) {
    throw ERR_UNAUTHENTICATED({
      message: `anonymous caller cannot perform ${reasonForLog}`,
    })
  }
  if (!isAdminAuth(actor)) {
    throw ERR_UNAUTHENTICATED({
      message: `non-admin actor cannot perform ${reasonForLog}`,
    })
  }

  return actor
}
