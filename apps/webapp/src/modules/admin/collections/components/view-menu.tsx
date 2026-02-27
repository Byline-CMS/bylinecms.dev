/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button, HistoryIcon, IconButton, Label, Select, SelectItem } from '@infonomic/uikit/react'

import { contentLocales, i18n } from '~/i18n'

export type ViewMenuPaths = 'edit' | 'history' | 'api'

/**
 * Shared mini-navigation bar for document-level views (Edit, History, API).
 * Renders a locale selector, the History icon button, Edit button, and API
 * button with appropriate variant styling based on the currently active view.
 * Changing the locale triggers a navigate to the current view's route so the
 * loader re-fetches with the new locale — all three views react automatically.
 */
export const ViewMenu = ({
  collection,
  documentId,
  activeView,
  locale,
}: {
  /** Collection path (e.g. "docs", "news"). */
  collection: string
  /** The document ID to navigate to. */
  documentId: string
  /** Which view is currently active — used to style the active button. */
  activeView?: ViewMenuPaths
  /** Current content locale. undefined means "All" (full multi-locale shape). */
  locale?: string
}) => {
  const navigate = useNavigate()

  // Edit view must never use 'all' locale — strip it from the URL and fall
  // back to the default locale if it somehow arrives via navigation.
  useEffect(() => {
    if (activeView === 'edit' && locale === 'all') {
      navigate({
        to: '/admin/collections/$collection/$id',
        params: { collection, id: documentId },
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          locale: i18n.content.defaultLocale,
        }),
      })
    }
  }, [activeView, locale, collection, documentId, navigate])

  const handleLocaleChange = (value: string) => {
    // Always put locale explicitly in the URL — 'all' is stored as 'all',
    // never as undefined, so the loader knows the intent unambiguously.
    const search = (prev: Record<string, unknown>) => ({ ...prev, locale: value })
    if (activeView === 'api') {
      navigate({
        to: '/admin/collections/$collection/$id/api',
        params: { collection, id: documentId },
        search: search as any,
      })
    } else if (activeView === 'history') {
      navigate({
        to: '/admin/collections/$collection/$id/history',
        params: { collection, id: documentId },
        search: search as any,
      })
    } else {
      navigate({
        to: '/admin/collections/$collection/$id',
        params: { collection, id: documentId },
        search: search as any,
      })
    }
  }

  return (
    <div className="flex items-center gap-2 mt-2 mb-2">
      <Label className="hidden lg:block muted text-gray-400 text-xs pt-[2px]" id="contentLocaleLabel" htmlFor="contentLocale" label="Content Locale:" />
      <Select
        name="contentLocale"
        id="contentLocale"
        className="min-w-[100px]"
        size="xs"
        variant="outlined"
        value={locale ?? i18n.content.defaultLocale}
        onValueChange={handleLocaleChange}
      >
        {activeView !== 'edit' && <SelectItem value="all">All</SelectItem>}
        {contentLocales.map((loc) => (
          <SelectItem key={loc.code} value={loc.code}>
            {loc.label}
          </SelectItem>
        ))}
      </Select>
      <IconButton
        className="min-w-[24px]"
        size="xs"
        variant={activeView === 'history' ? 'filled' : 'text'}
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id/history',
            params: { collection, id: documentId },
            search: locale ? { locale } : {},
          })
        }
      >
        <HistoryIcon className="w-5 h-5" />
      </IconButton>
      <Button
        size="xs"
        variant={activeView === 'edit' ? 'filled' : 'outlined'}
        className="min-w-[50px]"
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id',
            params: { collection, id: documentId },
            search: locale ? { locale } : {},
          })
        }
      >
        Edit
      </Button>
      <Button
        size="xs"
        variant={activeView === 'api' ? 'filled' : 'outlined'}
        className="min-w-[50px]"
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id/api',
            params: { collection, id: documentId },
            search: locale ? { locale } : {},
          })
        }
      >
        API
      </Button>
    </div>
  )
}
