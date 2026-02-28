/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Initialize Byline server config (DB adapter, etc.) before handling any requests.
import '../byline.server.config.ts'

// Initialize the client config so getClientConfig() and getCollectionAdminConfig()
// work during SSR rendering. This is safe because Vite SSR handles the CSS
// module / React component imports that admin configs may reference.
import '../byline.client.config.ts'

import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
