/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export {
  type Actor,
  AdminAuth,
  isAdminAuth,
  isUserAuth,
  UserAuth,
} from './actor.js'
export {
  createRequestContext,
  createSuperAdminContext,
  type RequestContext,
} from './context.js'
export {
  AuthError,
  type AuthErrorCode,
  AuthErrorCodes,
  type AuthErrorOptions,
  ERR_FORBIDDEN,
  ERR_UNAUTHENTICATED,
} from './errors.js'
