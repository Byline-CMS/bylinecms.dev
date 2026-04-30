/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/host-tanstack-start` — TanStack Start host adapter for Byline.
 *
 * Houses everything that's framework-coupled to TanStack Start /
 * Router so the framework-neutral packages (`@byline/core`, `@byline/admin`,
 * `@byline/client`, `@byline/auth`, `@byline/ui`) stay framework-neutral.
 *
 * Surface is exposed via subpath exports rather than a single root barrel
 * so hosts only pull in what they consume:
 *
 *   - `@byline/host-tanstack-start/server-fns/<module>` — TanStack Start
 *     server functions for each admin module (admin-account, admin-roles,
 *     admin-users, admin-permissions, auth, collections).
 *   - `@byline/host-tanstack-start/auth/auth-context` — request-scoped
 *     `RequestContext` resolution that reads session cookies, refreshes
 *     transparently, and surfaces `ERR_UNAUTHENTICATED` to callers.
 *   - `@byline/host-tanstack-start/integrations/*` — host-side adapters
 *     binding TanStack Start primitives to the framework-neutral
 *     contracts in `@byline/ui` and `@byline/client`
 *     (`bylineFieldServices`, `bylineAdminServices`, the admin
 *     `BylineClient` singleton).
 *   - `@byline/host-tanstack-start/admin-shell/{chrome,collections,...}` —
 *     router-coupled admin UI: shared shell chrome (menu drawer, app bar,
 *     route-error, breadcrumbs, etc.) plus per-area page containers.
 *   - `@byline/host-tanstack-start/routes/*` — route factories. Each
 *     factory returns the result of `createFileRoute(path)({...})` ready
 *     for assignment to the host's `export const Route = ...`. The host
 *     supplies the filesystem-backed path string; the package owns the
 *     loader, `beforeLoad`, component, and error boundary.
 *
 * The root entry exports nothing intentionally — every consumption path
 * is a subpath import. This keeps the public surface small and the
 * boundaries explicit.
 */

export {}
