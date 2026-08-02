/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Resolve the sign-in Home link without requiring a configured site origin. */
export function resolveSignInHomeUrl(homeUrl: string | undefined): string {
  return homeUrl ?? '/'
}
