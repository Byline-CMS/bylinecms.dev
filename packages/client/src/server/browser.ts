/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Browser-condition stub for `@byline/client/server`. Bundlers that
 * resolve the `browser` export condition land here instead of the real
 * server entry, so an accidental import from client-side code fails
 * loudly at load time instead of shipping session machinery to the
 * browser.
 */

throw new Error(
  '@byline/client/server is server-only. Import it from server routes, ' +
    'loaders, server functions, scripts, or lifecycle hooks — never from ' +
    'browser code.'
)

export {}
