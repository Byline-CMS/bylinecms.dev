/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'

import { Button, HistoryIcon, IconButton, Label, Select } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useNavigate } from '../chrome/loose-router.js'
import styles from './view-menu.module.css'

export type ViewMenuPaths = 'edit' | 'history' | 'api'

export interface ContentLocaleOption {
  code: string
  label: string
}

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
 *
 * `contentLocales` and `defaultContentLocale` are passed in from the host
 * route shell (which reads them from the host's i18n config) so this
 * component stays free of host-specific imports.
 */
export const ViewMenu = ({
  collection,
  documentId,
  activeView,
  locale,
  depth,
  contentLocales,
  defaultContentLocale,
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
  /** Content locales the host advertises in language switchers. */
  contentLocales: ReadonlyArray<ContentLocaleOption>
  /** Fallback content locale used when the URL has none. */
  defaultContentLocale: string
}) => {
  const navigate = useNavigate()

  // Edit view must never use 'all' locale — strip it from the URL and fall
  // back to the default locale if it somehow arrives via navigation.
  useEffect(() => {
    if (activeView === 'edit' && locale === 'all') {
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection, id: documentId },
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          locale: defaultContentLocale,
        }),
      })
    }
  }, [activeView, locale, collection, documentId, defaultContentLocale, navigate])

  const handleLocaleChange = (value: string | null) => {
    if (value == null) return
    // Always put locale explicitly in the URL — 'all' is stored as 'all',
    // never as undefined, so the loader knows the intent unambiguously.
    const search = (prev: Record<string, unknown>) => ({ ...prev, locale: value })
    if (activeView === 'api') {
      navigate({
        to: '/admin/collections/$collection/$id/api' as never,
        params: { collection, id: documentId },
        search: search as never,
      })
    } else if (activeView === 'history') {
      navigate({
        to: '/admin/collections/$collection/$id/history' as never,
        params: { collection, id: documentId },
        search: search as never,
      })
    } else {
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection, id: documentId },
        search: search as never,
      })
    }
  }

  const handleDepthChange = (value: string | null) => {
    if (value == null || activeView !== 'api') return
    const n = Number.parseInt(value, 10)
    const nextDepth = Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0
    navigate({
      to: '/admin/collections/$collection/$id/api' as never,
      params: { collection, id: documentId },
      // Store 0 as undefined so the URL stays clean when the user picks
      // "no populate" — avoids `?depth=0` in bookmarks / share links.
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        depth: nextDepth === 0 ? undefined : nextDepth,
      })) as never,
    })
  }

  return (
    <div className={cx('byline-view-menu', styles.root)}>
      <Label
        className={cx('muted byline-view-menu-label', styles.label)}
        id="contentLocaleLabel"
        htmlFor="contentLocale"
        label="Content Locale:"
      />
      <Select<string>
        name="contentLocale"
        id="contentLocale"
        className={cx('byline-view-menu-locale-select', styles.localeSelect)}
        size="xs"
        variant="outlined"
        value={locale ?? defaultContentLocale}
        items={[
          ...(activeView !== 'edit' ? [{ value: 'all', label: 'All' }] : []),
          ...contentLocales.map((loc) => ({ value: loc.code, label: loc.label })),
        ]}
        onValueChange={handleLocaleChange}
      />
      {activeView === 'api' && (
        <>
          <Label
            className={cx('muted byline-view-menu-label', styles.label)}
            id="populateDepthLabel"
            htmlFor="populateDepth"
            label="Depth:"
          />
          <Select<string>
            name="populateDepth"
            id="populateDepth"
            className={cx('byline-view-menu-depth-select', styles.depthSelect)}
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
        className={cx('byline-view-menu-icon-button', styles.iconButton)}
        size="xs"
        variant={activeView === 'history' ? 'filled' : 'text'}
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id/history' as never,
            params: { collection, id: documentId },
            search: locale ? { locale } : {},
          })
        }
      >
        <HistoryIcon className={cx('byline-view-menu-icon-button-icon', styles.iconButtonIcon)} />
      </IconButton>
      <Button
        size="xs"
        variant={activeView === 'edit' ? 'filled' : 'outlined'}
        className={cx('byline-view-menu-button', styles.button)}
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id' as never,
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
        className={cx('byline-view-menu-button', styles.button)}
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id/api' as never,
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
