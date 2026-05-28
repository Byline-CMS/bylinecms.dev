/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `resolveServerTranslator(namespace)` — server-side companion to the
 * client `useTranslation(namespace)` hook.
 *
 * Resolves the request locale via the same cascade the client hydrates
 * against (preferred → cookie → Accept-Language → default), constructs
 * a formatter bound to the registered translation bundle, and returns
 * a `{ t, locale }` for the requested namespace. The shape mirrors
 * `useTranslation` so callers can swap surfaces (loader vs component)
 * without rethinking the API.
 *
 * Typical use:
 *
 *   import { resolveServerTranslator } from '@byline/host-tanstack-start/i18n'
 *
 *   export const sendInviteFn = createServerFn(...).handler(async () => {
 *     const { t } = await resolveServerTranslator('byline-admin')
 *     return { subject: t('email.invite.subject') }
 *   })
 */

import { createFormatter, type LocaleCode } from '@byline/i18n'

import { bylineCore } from '../integrations/byline-core.js'
import { resolveRequestLocale } from './resolve-locale.js'

export interface ServerTranslator {
  t: (key: string, values?: Record<string, string | number | boolean | Date | null>) => string
  locale: LocaleCode
}

export async function resolveServerTranslator(namespace: string): Promise<ServerTranslator> {
  const core = bylineCore()
  const { interface: ifaceConfig, translations: bundle } = core.config.i18n
  if (bundle == null) {
    throw new Error(
      '[resolveServerTranslator] no translation bundle is registered. ' +
        'Pass `translations: adminTranslations({ en: true })` (or a merged bundle) ' +
        'on `i18n` in your config.'
    )
  }
  const activeLocale = await resolveRequestLocale()
  const formatter = createFormatter({
    bundle,
    activeLocale,
    defaultLocale: ifaceConfig.defaultLocale,
  })
  return {
    t: (key, values) => formatter.t(namespace, key, values),
    locale: activeLocale,
  }
}
