/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * TanStack Start instance configuration.
 *
 * Auto-discovered by the Start Vite plugin at `src/start.ts`. The only
 * role right now is to register serialization adapters so typed errors
 * (`AdminUsersError`, `AuthError`) survive the server-fn boundary with
 * their `code` intact — see `src/lib/start-errors.ts` for the full
 * rationale.
 *
 * Add further `serializationAdapters`, request/function middleware, or
 * `serverFns.fetch` overrides here as the app grows.
 */

import { createStart } from '@tanstack/react-start'

import { bylineCodedErrorAdapter } from './lib/start-errors'

export const startInstance = createStart(() => ({
  serializationAdapters: [bylineCodedErrorAdapter],
}))
