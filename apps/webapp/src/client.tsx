/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// NOTE: the Byline admin config is registered by the `_byline` route — its
// `beforeLoad` (before child loaders) and its `route.lazy.tsx` side-effect
// import (for component render / hydration), both importing
// `byline/admin.config`. That keeps the admin/editor graph code-split out of
// public-route bundles. Importing it here would pull that graph into the eager
// client bundle for every page.

import { StrictMode } from 'react'
import { StartClient } from '@tanstack/react-start/client'

import { hydrateRoot } from 'react-dom/client'

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
)
