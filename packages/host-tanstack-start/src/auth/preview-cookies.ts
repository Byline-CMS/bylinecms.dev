/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Cookie helpers for the front-end *preview mode* toggle.
 *
 * Preview mode lets a signed-in admin see draft (and other non-published)
 * versions on the public host pages without changing any markup or route
 * structure. The mechanic is intentionally narrow:
 *
 *   - A single httpOnly cookie (`byline_preview=1`) carries the user's
 *     "show me drafts" intent across requests within the same browser
 *     session.
 *   - The cookie's mere *presence* is the signal — there is no payload to
 *     verify. The actual safety check is the admin session: when the
 *     viewer client (or a server fn) sees the cookie, it tries to resolve
 *     `getAdminRequestContext()` and only elevates the read mode when a
 *     valid admin session resolves. A stale preview cookie on an
 *     anonymous browser falls through to public/published reads silently.
 *
 * Cookie attributes:
 *   - `httpOnly: true`   — inaccessible to JS; toggled only via server fns.
 *   - `sameSite: 'lax'`  — sent on top-level navigations only.
 *   - `secure: true` in production — https-only.
 *   - `path: '/'`        — visible to every public route.
 *   - `maxAge: 1 day`    — preview is meant to be a short-lived editorial
 *                          mode, not a permanent state. Admins can
 *                          re-enable from the admin UI when needed.
 */

import { getCookie, setCookie } from '@tanstack/react-start/server'

export const PREVIEW_COOKIE = 'byline_preview'
const PREVIEW_MAX_AGE_SECONDS = 60 * 60 * 24 // 1 day

const IS_PROD = process.env.NODE_ENV === 'production'

/** True iff the preview cookie is currently set on the request. */
export function readPreviewCookie(): boolean {
  return getCookie(PREVIEW_COOKIE) === '1'
}

/**
 * Write the preview cookie. Callers should ensure the request is from a
 * valid admin session before invoking — the cookie itself is just a flag
 * and carries no proof of authorisation. See `enablePreviewModeFn` for
 * the canonical entry point.
 */
export function setPreviewCookie(): void {
  setCookie(PREVIEW_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: PREVIEW_MAX_AGE_SECONDS,
  })
}

/** Clear the preview cookie. Safe to call from any context. */
export function clearPreviewCookie(): void {
  setCookie(PREVIEW_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  })
}
