/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// NOTE: Byline client config is now initialized in src/config/init-client-config.ts,
// imported from __root.tsx, so it is available in both SSR and client contexts.
// This legacy import is kept for safety but is no longer strictly necessary.
import '../byline.admin.config.ts'

import { StrictMode } from 'react'
import { StartClient } from '@tanstack/react-start/client'

import { hydrateRoot } from 'react-dom/client'

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
)
