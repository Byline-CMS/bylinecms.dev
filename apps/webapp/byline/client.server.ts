/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only application boundary for the host-owned client singletons.
 * The host stays config-agnostic; this is the one assertion that binds its
 * runtime collection config to this application's inferred registry.
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
