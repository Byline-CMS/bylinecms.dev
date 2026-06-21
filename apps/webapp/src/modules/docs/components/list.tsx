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
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'
import styles from './list.module.css'
import type { Locale } from '@/i18n/i18n-config'
import type { DocNavNode } from '@/modules/docs/nav'

interface DocsListProps {
  nodes: DocNavNode[]
  lng: Locale
}

export function DocsList({ nodes, lng }: DocsListProps): React.JSX.Element {
  const { t } = useTranslations('frontend')
  return (
    <>
      <BreadcrumbsClient breadcrumbs={[{ label: t('docsTitle'), href: '/docs' }]} />
      <div className="prose">
        <h1>{t('docsTitle')}</h1>
        <p className={cx('byline-docs-list-lead', styles.lead)}>{t('docsLead')}</p>

        <div className={cx('byline-docs-list', styles.grid)}>
          {nodes.map((node) => (
            <DocCard key={node.id} node={node} lng={lng} />
          ))}
        </div>
      </div>
    </>
  )
}

interface DocCardProps {
  node: DocNavNode
  lng: Locale
}

function DocCard({ node, lng }: DocCardProps): React.JSX.Element {
  const title = node.title
  const summary = node.summary

  return (
    <Card
      className={cx('byline-docs-list-card', styles.card)}
      render={
        <Link
          to="/$lng/docs/$"
          params={{ ...lngParam(lng), _splat: node.chain.join('/') }}
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
