/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { Link } from '@tanstack/react-router'

import { Card, ChevronRightIcon } from '@byline/ui/react'
import cx from 'classnames'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import styles from './list.module.css'
import type { Locale } from '@/i18n/i18n-config'
import type { DocListItem } from '@/modules/docs/list'

interface DocsListProps {
  docs: DocListItem[]
  lng: Locale
}

export function DocsList({ docs, lng }: DocsListProps): React.JSX.Element {
  const { t } = useTranslations('frontend')
  return (
    <div className="prose">
      <h1>{t('docsTitle')}</h1>
      <p className={cx('byline-docs-list-lead', styles.lead)}>{t('docsLead')}</p>

      <div className={cx('byline-docs-list', styles.grid)}>
        {docs.map((doc) => (
          <DocCard key={doc.id} doc={doc} lng={lng} />
        ))}
      </div>
    </div>
  )
}

interface DocCardProps {
  doc: DocListItem
  lng: Locale
}

function DocCard({ doc, lng }: DocCardProps): React.JSX.Element {
  const title = doc.fields.title ?? doc.path ?? doc.id
  const summary = doc.fields.summary?.trim()

  return (
    <Card
      className={cx('byline-docs-list-card', styles.card)}
      render={
        <Link
          to="/$lng/docs/$path"
          params={{ ...lngParam(lng), path: doc.path }}
          aria-label={`Read ${title}`}
        />
      }
    >
      <Card.Header className={styles.header}>
        <Card.Title>
          <h2 className={cx('byline-docs-list-title', styles.title)}>{title}</h2>
        </Card.Title>
      </Card.Header>
      <Card.Content className={styles.content}>
        {summary ? (
          <p className={cx('byline-docs-list-summary', styles.summary)}>{summary}</p>
        ) : (
          <p
            className={cx(
              'byline-docs-list-summary byline-docs-list-summary-empty',
              styles.summary,
              styles.summaryEmpty
            )}
          >
            No summary available.
          </p>
        )}
      </Card.Content>
      <Card.Footer className={styles.footer}>
        <span className={cx('byline-docs-list-cta', styles.cta)}>
          Read more
          <span className={styles.ctaIcon} aria-hidden="true">
            <ChevronRightIcon width="16px" height="16px" />
          </span>
        </span>
      </Card.Footer>
    </Card>
  )
}
