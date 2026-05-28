/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/host-tanstack-start/i18n` — host-side glue between the
 * admin interface translation registry and TanStack Start's request
 * model. Cookie helpers, the per-request locale resolver, and the
 * server-side `resolveServerTranslator` companion to the client
 * `useTranslation` hook.
 */

export {
  ADMIN_LOCALE_COOKIE,
  clearAdminLocaleCookie,
  readAdminLocaleCookie,
  setAdminLocaleCookie,
} from './locale-cookie.js'
export { resolveRequestLocale } from './resolve-locale.js'
export { resolveServerTranslator } from './server-translator.js'
export type { ServerTranslator } from './server-translator.js'
