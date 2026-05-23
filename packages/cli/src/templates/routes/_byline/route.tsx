/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pathless route definition for everything Byline-rendered (the admin
 * shell and the sign-in page). The `_byline` prefix doesn't contribute
 * to URL paths — `/_byline/admin/...` resolves to `/admin/...` and
 * `/_byline/sign-in` resolves to `/sign-in`.
 *
 * This file is intentionally bare. The router needs the route definition
 * at startup to build the tree for URL matching, so anything declared
 * here ends up in the eager module graph (and Vite will modulepreload
 * its dependencies on every page).
 *
 * The component, providers, Byline UI stylesheets, and the admin config
 * side-effect import live in the sibling `route.lazy.tsx` — TanStack
 * Router loads that file on demand when a `_byline/*` URL matches, so
 * the editor + admin shell deps stay out of public-route bundles.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_byline')({})
