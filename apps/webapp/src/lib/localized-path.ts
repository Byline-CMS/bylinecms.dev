/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { i18nConfig } from '@/i18n/i18n-config'

/**
 * Build a locale-prefixed URL path from one or more segments.
 *
 * The public routing rule: the frontend's default locale renders without a
 * prefix, all others get `/<lng>` prepended. `LangLink`, `useLanguageSwitcher`,
 * canonical and alternate metadata, and the admin preview URL builders all
 * follow it. It lives in its own module so the admin configuration can import
 * it without the rest of the metadata helpers.
 *
 * @example
 *   buildLocalizedPath('en', 'about', 'team')   // -> '/about/team'
 *   buildLocalizedPath('es', 'about', 'team')   // -> '/es/about/team'
 *   buildLocalizedPath(undefined, 'contact')    // -> '/contact'
 */
export function buildLocalizedPath(
  lng: string | undefined,
  ...segments: Array<string | null | undefined>
): string {
  const prefix = lng != null && lng !== i18nConfig.defaultLocale ? `/${lng}` : ''
  const path = segments
    .filter((s): s is string => s != null && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/')
  // No segments — return `/` (default locale) or `/<lng>` (no trailing
  // slash) so home-page canonicals stay clean.
  if (path.length === 0) return prefix.length > 0 ? prefix : '/'
  return `${prefix}/${path}`
}
