/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import type { MultiCollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { useTranslation } from '@byline/i18n/react'
import {
  Container,
  CopyIcon,
  DownloadIcon,
  IconButton,
  Section,
  Tooltip,
  useToastManager,
} from '@byline/ui/react'
import cx from 'clsx'
import { darkStyles, JsonView } from 'react-json-view-lite'

import styles from './api.module.css'
import { ViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from './view-menu.js'
import 'react-json-view-lite/dist/index.css'

/**
 * Expand the document root and the level below it — the document's own metadata
 * and the names of its content fields — and leave everything deeper collapsed.
 *
 * `react-json-view-lite` does not mount collapsed descendants, so this reduces the
 * size of the mounted tree rather than merely hiding nodes. A document with rich
 * text, blocks, several locales and populated relations otherwise mounts thousands
 * of nodes that the reader has to scroll past before finding anything.
 *
 * Declared at module scope so its identity is stable: the viewer treats a new
 * callback as a reason to re-derive expansion state, which would discard whatever
 * the reader had opened.
 */
const expandToFirstLevel = (level: number): boolean => level < 2

/**
 * JSON inspector view for a collection document.
 *
 * Copy JSON and Download JSON render in the view menu's data group, beside the
 * locale and depth controls whose selection they export.
 *
 * Stable override handles: `.byline-api-section`, `.byline-api-container`,
 * `.byline-api-head`, `.byline-api-title`, `.byline-api-action`,
 * `.byline-api-viewer`.
 */
export const ApiView = ({
  collectionDefinition,
  initialData,
  locale,
  depth,
  contentLocales,
  defaultContentLocale,
}: {
  collectionDefinition: MultiCollectionDefinition
  initialData: AnyCollectionSchemaTypes['UpdateType']
  /** Locale from the route search param (undefined → the default content locale). */
  locale?: string
  /** Populate depth from the route search param (undefined → 0, no populate). */
  depth?: number
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const { labels, path } = collectionDefinition
  const { t } = useTranslation('byline-admin')
  const toastManager = useToastManager()
  const [copyPending, setCopyPending] = useState(false)

  // Serialize only on demand, from the complete loaded payload rather than
  // the mounted tree. Collapsed branches remain part of both exports.
  const copyJson = async () => {
    setCopyPending(true)
    try {
      await navigator.clipboard.writeText(JSON.stringify(initialData, null, 2))
      toastManager.add({
        title: t('collections.api.copied'),
        data: { intent: 'success', iconType: 'success', icon: true, close: true },
      })
    } catch {
      toastManager.add({
        title: t('collections.api.copyFailed'),
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    } finally {
      setCopyPending(false)
    }
  }

  const downloadJson = () => {
    try {
      const blob = new Blob([JSON.stringify(initialData, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = url
        // Name the selection, so exports of one document in different locales
        // or population depths do not collide.
        const selection = [path, String(initialData.id), locale ?? defaultContentLocale]
        if (depth != null && depth > 0) selection.push(`depth${depth}`)
        const filename = selection.join('-').replace(/[^a-zA-Z0-9_-]/g, '-')
        link.download = `${filename}.json`
        document.body.appendChild(link)
        link.click()
      } finally {
        link.remove()
        // Let the browser acquire the download before releasing its URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      toastManager.add({
        title: t('collections.api.downloadFailed'),
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    }
  }

  return (
    <Section className={cx('byline-api-section', styles.section)}>
      <Container className={cx('byline-api-container', styles.container)}>
        <div className={cx('byline-api-head', styles.head)}>
          <h2 className={cx('byline-api-title', styles.title)}>
            {t('collections.api.title', { label: labels.singular })}
          </h2>
          <ViewMenu
            collection={path}
            documentId={String(initialData.id)}
            activeView="api"
            locale={locale}
            depth={depth}
            contentLocales={contentLocales}
            defaultContentLocale={defaultContentLocale}
            dataActions={
              <>
                <Tooltip text={t('collections.api.copyJson')} side="bottom" delay={0}>
                  <IconButton
                    type="button"
                    size="xs"
                    variant="text"
                    className="byline-view-menu-icon-button byline-api-action"
                    aria-label={t('collections.api.copyJson')}
                    disabled={copyPending}
                    onClick={copyJson}
                  >
                    <CopyIcon width="18px" height="18px" />
                  </IconButton>
                </Tooltip>
                <Tooltip text={t('collections.api.downloadJson')} side="bottom" delay={0}>
                  <IconButton
                    type="button"
                    size="xs"
                    variant="text"
                    className="byline-view-menu-icon-button byline-api-action"
                    aria-label={t('collections.api.downloadJson')}
                    onClick={downloadJson}
                  >
                    <DownloadIcon width="20px" height="20px" />
                  </IconButton>
                </Tooltip>
              </>
            }
          />
        </div>
        <div className={cx('byline-api-viewer', styles.viewer)}>
          <JsonView
            data={initialData}
            shouldExpandNode={expandToFirstLevel}
            style={{ ...darkStyles, container: 'api-json-view' }}
          />
        </div>
      </Container>
    </Section>
  )
}
