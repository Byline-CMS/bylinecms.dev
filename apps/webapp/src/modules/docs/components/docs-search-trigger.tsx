'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Docs search entry point in the nav drawer header: a magnifying-glass
 * `IconButton` that opens a modal with a single search field. On submit
 * (click / enter — no type-ahead) it navigates to the dedicated, shareable
 * results route (`/<lng>/docs/search?q=`) where the search runs server-side.
 */

import type React from 'react'
import { useNavigate } from '@tanstack/react-router'

import { IconButton, Modal, Search, SearchIcon, useModal } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import type { Locale } from '@/i18n/i18n-config'

export function DocsSearchTrigger({ lng }: { lng: Locale }): React.JSX.Element {
  const navigate = useNavigate()
  const { t } = useTranslations('frontend')
  const { isOpen, onOpen, onDismiss } = useModal()

  const runSearch = (value: string): void => {
    const q = value.trim()
    onDismiss()
    if (q.length === 0) return
    navigate({ to: '/$lng/docs/search', params: lngParam(lng), search: { q } })
  }

  return (
    <>
      <IconButton aria-label={t('docsSearchHeading')} onClick={onOpen}>
        <SearchIcon width="18px" height="18px" />
      </IconButton>

      <Modal isOpen={isOpen} closeOnOverlayClick onDismiss={onDismiss}>
        <Modal.Container style={{ maxWidth: '560px' }}>
          <Modal.Header>{t('docsSearchHeading')}</Modal.Header>
          <Modal.Content>
            <Search
              autoFocus
              placeHolderText={t('docsSearchPlaceholder')}
              ariaLabelForSearch={t('docsSearchPlaceholder')}
              onSearch={runSearch}
              onEnter={runSearch}
              // Just empty the field — without an explicit handler the widget
              // falls back to a `window.location.search` reload.
              onClear={() => {}}
            />
          </Modal.Content>
        </Modal.Container>
      </Modal>
    </>
  )
}
