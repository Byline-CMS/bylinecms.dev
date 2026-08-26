'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'

import type { SingletonAdminConfig, SingletonPreviewDocument } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, HistoryIcon, IconButton, Label, Select } from '@byline/ui/react'
import cx from 'clsx'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import { useNavigate } from '../chrome/loose-router.js'
import collectionStyles from '../collections/view-menu.module.css'
import { SingletonPreviewLink } from './preview-link.js'
import type { ContentLocaleOption } from '../collections/view-menu.js'

export type SingletonViewMenuPath = 'edit' | 'history'

/** Id-less edit/history navigation; preview appears only for a mapped document. */
export function SingletonViewMenu({
  singleton,
  activeView,
  locale,
  contentLocales,
  defaultContentLocale,
  adminConfig,
  doc,
}: {
  singleton: string
  activeView: SingletonViewMenuPath
  locale?: string
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
  adminConfig?: SingletonAdminConfig
  doc?: SingletonPreviewDocument
}) {
  const navigate = useNavigate()
  const { t } = useTranslation('byline-admin')

  // Edit always represents one concrete locale. Strip the history-only `all`
  // sentinel if a copied URL brings it back to the form.
  useEffect(() => {
    if (activeView === 'edit' && locale === 'all') {
      navigate({
        to: getAdminRoutePath('singletons', '$singleton'),
        params: { singleton },
        search: { locale: defaultContentLocale },
        replace: true,
      })
    }
  }, [activeView, locale, singleton, defaultContentLocale, navigate])

  const handleLocaleChange = (value: string | null) => {
    if (value == null) return
    navigate({
      to:
        activeView === 'history'
          ? getAdminRoutePath('singletons', '$singleton', 'history')
          : getAdminRoutePath('singletons', '$singleton'),
      params: { singleton },
      search: { locale: value },
    })
  }

  return (
    <div className={cx('byline-view-menu', collectionStyles.root)}>
      <Label
        className={cx('muted byline-view-menu-label', collectionStyles.label)}
        id="contentLocaleLabel"
        htmlFor="contentLocale"
        label={t('collections.viewMenu.contentLocaleLabel')}
      />
      <Select<string>
        name="contentLocale"
        id="contentLocale"
        className={cx('byline-view-menu-locale-select', collectionStyles.localeSelect)}
        size="xs"
        variant="outlined"
        value={locale ?? defaultContentLocale}
        items={[
          ...(activeView === 'history'
            ? [{ value: 'all', label: t('collections.viewMenu.localeAll') }]
            : []),
          ...contentLocales.map((entry) => ({ value: entry.code, label: entry.label })),
        ]}
        onValueChange={handleLocaleChange}
      />
      {adminConfig?.preview != null && doc != null && (
        <SingletonPreviewLink
          doc={doc}
          adminConfig={adminConfig}
          locale={locale}
          className={cx('byline-view-menu-icon-button', collectionStyles.iconButton)}
        />
      )}
      <IconButton
        className={cx('byline-view-menu-icon-button', collectionStyles.iconButton)}
        size="xs"
        variant={activeView === 'history' ? 'filled' : 'text'}
        aria-label={t('collections.breadcrumbs.history')}
        onClick={() =>
          navigate({
            to: getAdminRoutePath('singletons', '$singleton', 'history'),
            params: { singleton },
            search: locale ? { locale } : {},
          })
        }
      >
        <HistoryIcon
          className={cx('byline-view-menu-icon-button-icon', collectionStyles.iconButtonIcon)}
        />
      </IconButton>
      <Button
        size="xs"
        variant={activeView === 'edit' ? 'filled' : 'outlined'}
        className={cx('byline-view-menu-button', collectionStyles.button)}
        onClick={() =>
          navigate({
            to: getAdminRoutePath('singletons', '$singleton'),
            params: { singleton },
            search: locale ? { locale } : {},
          })
        }
      >
        {t('common.actions.edit')}
      </Button>
    </div>
  )
}
