/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Typed, server-only access to this application's Byline clients.
 *
 * ```text
 * generated/collection-types.ts
 *   `CollectionFieldsByPath`
 *              |
 *              v
 * collections/index.ts --------------------.
 *   `BylineCollections`                    |
 *                                          v
 * @byline/host-tanstack-start ------> clients.server.ts
 *   runtime client getters             |
 *                                      v
 *                           typed `get*BylineClient()` getters
 * ```
 *
 * Why this boundary exists:
 *
 * The TanStack host owns the runtime admin, public, system, and viewer client
 * singletons. It intentionally knows nothing about an application's collection
 * schemas, so its getters cannot provide application-specific collection paths
 * and field shapes. The generated `CollectionFieldsByPath` registry is exported
 * as `BylineCollections` by `collections/index.ts`; this module joins the host
 * getters and app registry once instead of repeating a type assertion at every
 * server call site.
 *
 * Typical server usage:
 *
 * ```ts
 * const publicClient = getPublicBylineClient() // anonymous published reads
 * const viewerClient = getViewerBylineClient() // public or admin-preview reads
 * const adminClient = getAdminBylineClient() // current admin request authority
 * const systemClient = getSystemBylineClient() // trusted hooks and maintenance
 * ```
 *
 * Calls such as `systemClient.collection('docs')` are therefore checked against
 * this application's generated registry and return the canonical generated
 * field shape for `docs`. `collection-types.contract.ts` separately proves that
 * those generated shapes still match the runtime collection schemas exactly.
 *
 * The `.server.ts` suffix is intentional. Import these getters only from server
 * routes, loaders, actions, scripts, or lifecycle-hook modules; browser code
 * must not cross this boundary.
 *
 * This module does not create client singletons, generate collection types, or
 * configure the host. It only applies the app-specific client type and
 * re-exports the host-owned getters (plus the viewer preview-state helper).
 */
import type { BylineClient } from '@byline/client'
import {
  getAdminBylineClient as getHostAdminBylineClient,
  getSystemBylineClient as getHostSystemBylineClient,
} from '@byline/host-tanstack-start/integrations/byline-client'
import { getPublicBylineClient as getHostPublicBylineClient } from '@byline/host-tanstack-start/integrations/byline-public-client'
import {
  getViewerBylineClient as getHostViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { BylineCollections } from './collections/index.js'

type AppBylineClient = BylineClient<BylineCollections>

export const getAdminBylineClient = getHostAdminBylineClient as () => AppBylineClient
export const getPublicBylineClient = getHostPublicBylineClient as () => AppBylineClient
export const getSystemBylineClient = getHostSystemBylineClient as () => AppBylineClient
export const getViewerBylineClient = getHostViewerBylineClient as () => AppBylineClient
export { isPreviewActive }
