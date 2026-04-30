/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// NOTE: Byline admin config is initialized via a side-effect import in
// `src/routes/__root.tsx`. That module runs in both the SSR render and
// client module graphs, so importing it here would only duplicate the
// registration in the client bundle.

import { StrictMode } from 'react'
import { StartClient } from '@tanstack/react-start/client'

import { hydrateRoot } from 'react-dom/client'

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
)
