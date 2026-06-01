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
 * This file is intentionally light. The router needs the route definition
 * at startup to build the tree for URL matching, so anything *statically*
 * imported here ends up in the eager module graph (and Vite will
 * modulepreload its dependencies on every page).
 *
 * The component and providers live in the sibling `route.lazy.tsx` —
 * TanStack Router loads that file on demand when a `_byline/*` URL
 * matches, so the editor + admin shell deps stay out of public-route
 * bundles.
 *
 * Registering the Byline client config has two complementary entry points
 * (both call `defineClientConfig` idempotently):
 *  - the `beforeLoad` below — covers the *loader* phase, resolving before any
 *    `_byline/*` child loader reads the config;
 *  - the side-effect import in `route.lazy.tsx` — covers component render /
 *    initial hydration, where `beforeLoad` is not re-run.
 * Both use `byline/admin.config` (a dynamic import here), so its module graph
 * stays code-split out of the eager/public bundle — only the tiny `beforeLoad`
 * function is eager.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_byline')({
  beforeLoad: async () => {
    // Register the Byline client config (`defineClientConfig` runs as a
    // side-effect of importing `byline/admin.config`) before any `_byline/*`
    // child loader reads it — e.g. the admin dashboard loader's
    // `getClientConfig()`. A parent route's `beforeLoad` resolves before its
    // children's loaders run, which closes the dev race where the loader
    // outran the lazy component module's side-effect import (on the client
    // there is no server-config fallback, so `getClientConfig()` threw
    // "Byline has not been configured yet"). The dynamic import keeps
    // `admin.config` out of the eager/public bundle and evaluates once
    // (cached). NOTE: `beforeLoad` is not re-run on initial client hydration
    // (the SSR result is dehydrated), so the `route.lazy.tsx` side-effect
    // import is what registers the config for the hydrated component render.
    await import('../../../byline/admin.config')
  },
})
