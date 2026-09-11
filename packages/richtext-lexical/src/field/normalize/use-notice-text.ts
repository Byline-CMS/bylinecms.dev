'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useContext, useMemo } from 'react'

import { I18nContext } from '@byline/i18n/react'

/**
 * English text for every key this package renders.
 *
 * These duplicate the `byline-admin` bundle on purpose. The editor can
 * be mounted outside the admin shell — a host embedding a field, an
 * error boundary rendering without its route's providers — and
 * `useTranslation` throws when no provider is present. A notice must
 * never be the thing that breaks a field, so it degrades to English
 * rather than to an exception.
 */
const FALLBACKS: Readonly<Record<string, string>> = {
  'richtext.adapted.notice':
    'This content contains formatting this editor no longer supports. Saving edits will use the supported formatting.',
  'richtext.unsupported.notice':
    'This content contains {items}, which this field no longer supports. The field is read-only so the content is not lost.',
  'richtext.unsupported.action':
    'Ask an administrator to restore support for it, or to migrate the content.',
  'richtext.content.image': 'an image',
  'richtext.content.youtube': 'a YouTube embed',
  'richtext.content.vimeo': 'a Vimeo embed',
}

export interface NoticeText {
  t: (key: string, values?: Record<string, string>) => string
  locale: string
}

/**
 * Translate a notice, tolerating the absence of an I18nProvider.
 *
 * Reads `I18nContext` directly rather than calling `useTranslation`,
 * which throws without a provider.
 */
export function useNoticeText(): NoticeText {
  const context = useContext(I18nContext)

  return useMemo(() => {
    if (context == null) {
      return {
        locale: 'en',
        t: (key, values) => interpolate(FALLBACKS[key] ?? key, values),
      }
    }
    return {
      locale: context.activeLocale,
      t: (key, values) => context.formatter.t('byline-admin', key, values),
    }
  }, [context])
}

/** Minimal `{name}` substitution for the provider-less fallback path. */
function interpolate(template: string, values?: Record<string, string>): string {
  if (values == null) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
}
