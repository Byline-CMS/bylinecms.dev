/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/client/server` — the client SDK's server-side entry point.
 *
 * Request-bound `BylineClient` getters and the session/preview machinery
 * behind them, implemented against the `HostRequestBridge` seam
 * (`@byline/core`) so this surface is host-framework agnostic. A host
 * adapter (e.g. `@byline/host-tanstack-start`) registers the bridge at
 * server boot; application code imports the getters from here and never
 * touches the host framework.
 *
 * Server-only: the package's `browser` export condition resolves this
 * subpath to a stub that throws, so an accidental import from browser
 * code fails loudly at bundle time rather than leaking server machinery.
 */

export { getAdminRequestContext } from './admin-context.js'
export {
  getAdminBylineClient,
  getPublicBylineClient,
  getSystemBylineClient,
  getViewerBylineClient,
  isPreviewActive,
  resolvePublicRequestContext,
  resolveViewerRequestContext,
} from './clients.js'
export {
  clearPreviewCookie,
  PREVIEW_COOKIE,
  readPreviewCookie,
  setPreviewCookie,
} from './preview-cookies.js'
export { oncePerRequest } from './request-scope.js'
export {
  ACCESS_TOKEN_COOKIE,
  clearSessionCookies,
  REFRESH_TOKEN_COOKIE,
  readAccessTokenCookie,
  readRefreshTokenCookie,
  type SessionCookieTokens,
  setSessionCookies,
} from './session-cookies.js'
