/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSignInRoute } from '@byline/host-tanstack-start/routes'

// The Home link defaults to '/'. Pass { homeUrl: 'https://example.com/' }
// when the public site uses a different origin.
export const Route = createSignInRoute('/_byline/sign-in')
