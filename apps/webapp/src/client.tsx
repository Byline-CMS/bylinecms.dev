/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Initialize Byline config by importing the browser-safe client config.
import '../byline.client.config.ts'

import { StrictMode } from 'react'
import { StartClient } from '@tanstack/react-start/client'

import { hydrateRoot } from 'react-dom/client'

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>
)
