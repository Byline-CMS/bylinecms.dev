/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Client-safe public configuration. Keep this barrel free of admin and server imports. */
export { contentLocales, interfaceLocales } from './locales.js'
export { routes } from './routes.js'
export type { LocaleDefinition } from './locales.js'
