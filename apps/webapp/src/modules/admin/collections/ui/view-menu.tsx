/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button, HistoryIcon, IconButton, Label, Select } from '@infonomic/uikit/react'

import { contentLocales, i18n } from '~/i18n'

export type ViewMenuPaths = 'edit' | 'history' | 'api'

/**
 * Shared mini-navigation bar for document-level views (Edit, History, API).
 * Renders a locale selector, the History icon button, Edit button, and API
 * button with appropriate variant styling based on the currently active view.
 * Changing the locale triggers a navigate to the current view's route so the
 * loader re-fetches with the new locale — all three views react automatically.
 *
 * On the API route, an additional Depth selector appears — it drives the
 * `populateDocuments` call inside the api loader and lets editors see
 * what a client library `find({ populate: true, depth: N })` call would
 * return. Capped at 3 in the UI to avoid runaway fan-out.
 */
export const ViewMenu = ({
  collection,
  documentId,
  activeView,
  locale,
  depth,
}: {
  /** Collection path (e.g. "docs", "news"). */
  collection: string
  /** The document ID to navigate to. */
  documentId: string
  /** Which view is currently active — used to style the active button. */
  activeView?: ViewMenuPaths
  /** Current content locale. undefined means "All" (full multi-locale shape). */
  locale?: string
  /** Populate depth (api route only). undefined → 0 (no populate). */
  depth?: number
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

  const handleLocaleChange = (value: string | null) => {
    if (value == null) return
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

  const handleDepthChange = (value: string | null) => {
    if (value == null || activeView !== 'api') return
    const n = Number.parseInt(value, 10)
    const nextDepth = Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0
    navigate({
      to: '/admin/collections/$collection/$id/api',
      params: { collection, id: documentId },
      // Store 0 as undefined so the URL stays clean when the user picks
      // "no populate" — avoids `?depth=0` in bookmarks / share links.
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        depth: nextDepth === 0 ? undefined : nextDepth,
      })) as any,
    })
  }

  return (
    <div className="flex items-center gap-2 mt-2 mb-2">
      <Label
        className="hidden lg:block muted text-gray-400 text-xs pt-[2px]"
        id="contentLocaleLabel"
        htmlFor="contentLocale"
        label="Content Locale:"
      />
      <Select<string>
        name="contentLocale"
        id="contentLocale"
        className="min-w-[100px]"
        size="xs"
        variant="outlined"
        value={locale ?? i18n.content.defaultLocale}
        items={[
          ...(activeView !== 'edit' ? [{ value: 'all', label: 'All' }] : []),
          ...contentLocales.map((loc) => ({ value: loc.code, label: loc.label })),
        ]}
        onValueChange={handleLocaleChange}
      />
      {activeView === 'api' && (
        <>
          <Label
            className="hidden lg:block muted text-gray-400 text-xs pt-[2px]"
            id="populateDepthLabel"
            htmlFor="populateDepth"
            label="Depth:"
          />
          <Select<string>
            name="populateDepth"
            id="populateDepth"
            className="min-w-[60px]"
            size="xs"
            variant="outlined"
            value={String(depth ?? 0)}
            items={[
              { value: '0', label: '0' },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            onValueChange={handleDepthChange}
          />
        </>
      )}
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
