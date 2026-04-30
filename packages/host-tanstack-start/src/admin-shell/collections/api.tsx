/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Container, Section } from '@infonomic/uikit/react'
import cx from 'classnames'
import { allExpanded, darkStyles, JsonView } from 'react-json-view-lite'

import styles from './api.module.css'
import { ViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from './view-menu.js'
import 'react-json-view-lite/dist/index.css'

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
  collectionDefinition: CollectionDefinition
  initialData: AnyCollectionSchemaTypes['UpdateType']
  /** Currently active locale from the route search param (undefined → all). */
  locale?: string
  /** Populate depth from the route search param (undefined → 0, no populate). */
  depth?: number
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const { labels, path } = collectionDefinition

  return (
    <Section className={cx('byline-api-section', styles.section)}>
      <Container className={cx('byline-api-container', styles.container)}>
        <div className={cx('byline-api-head', styles.head)}>
          <h2 className={cx('byline-api-title', styles.title)}>{labels.singular} API</h2>
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
            shouldExpandNode={allExpanded}
            style={{ ...darkStyles, container: 'api-json-view' }}
          />
        </div>
      </Container>
    </Section>
  )
}
