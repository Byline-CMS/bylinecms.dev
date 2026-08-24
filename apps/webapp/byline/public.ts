/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Blessed client-safe facade for host-owned Byline configuration.
 *
 * Public React routes import this module instead of `admin.config.ts`,
 * `server.config.ts`, or `i18n.ts`. Keep every export plain data with a
 * browser-safe dependency graph; adding an admin or server import here would
 * leak those graphs into the public bundle.
 */

// Content-language definitions are safe for language menus, alternates, and
// sitemap generation. Admin locale bundles deliberately remain private.
export { contentLocales } from './locales.js'
// Resolved host paths are shared without importing either registered config.
export { routes } from './routes.js'
