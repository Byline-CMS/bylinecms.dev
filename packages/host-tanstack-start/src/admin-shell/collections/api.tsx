/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { MultiCollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { useTranslation } from '@byline/i18n/react'
import { Container, Section } from '@byline/ui/react'
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
 * Stable override handles: `.byline-api-section`, `.byline-api-container`,
 * `.byline-api-head`, `.byline-api-title`, `.byline-api-viewer`.
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
  /** Currently active locale from the route search param (undefined → all). */
  locale?: string
  /** Populate depth from the route search param (undefined → 0, no populate). */
  depth?: number
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const { labels, path } = collectionDefinition
  const { t } = useTranslation('byline-admin')

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
