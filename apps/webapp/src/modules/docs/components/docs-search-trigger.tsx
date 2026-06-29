'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Search } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import type { Locale } from '@/i18n/i18n-config'

export function DocsSearchTrigger({ lng }: { lng: Locale }): React.JSX.Element {
  const navigate = useNavigate()
  const { t } = useTranslations('frontend')

  const runSearch = (value: string): void => {
    const q = value.trim()
    if (q.length === 0) return
    navigate({ to: '/$lng/docs/search', params: lngParam(lng), search: { q } })
  }

  // Clearing the field returns to the docs table of contents (the index).
  const onClear = (): void => {
    navigate({ to: '/$lng/docs', params: lngParam(lng) })
  }

  return (
    <Search
      className="w-full"
      autoFocus
      placeHolderText={t('docsSearchPlaceholder')}
      ariaLabelForSearch={t('docsSearchPlaceholder')}
      onSearch={runSearch}
      onEnter={runSearch}
      onClear={onClear}
    />
  )
}
