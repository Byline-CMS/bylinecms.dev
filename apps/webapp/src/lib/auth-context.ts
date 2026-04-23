/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Request-scoped auth context for admin server functions.
 *
 * **Phase 4 placeholder.** This currently returns a super-admin context
 * for every call so that existing admin server fns keep working without
 * an authentication surface in front of them.
 *
 * **Phase 5 will replace the body** with a middleware-derived resolver
 * that reads the session cookie / `Authorization` header, calls
 * `core.sessionProvider.verifyAccessToken`, and returns the authenticated
 * actor. The call sites — `createCollectionDocument`, `updateDocument`,
 * `deleteDocument`, `updateDocumentStatus`, `unpublishDocument`,
 * `uploadFile`, etc. — stay the same; only the internals change.
 *
 * Intentionally NOT exported from any client-facing surface — it's a
 * webapp-internal helper.
 */

import { createSuperAdminContext, type RequestContext } from '@byline/auth'

export async function getAdminRequestContext(): Promise<RequestContext> {
  // TODO(phase-5): resolve actor via session provider + middleware.
  return createSuperAdminContext({ id: 'webapp-admin-placeholder' })
}
