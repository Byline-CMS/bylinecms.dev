/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { WorkflowStatus } from '@byline/core'
import { getClientConfig, getWorkflowStatuses } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Card, Container, Section } from '@byline/ui/react'
import cx from 'classnames'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import styles from './dashboard.module.css'
import { Link } from './loose-router.js'
import type { CollectionStatusCount } from '../../server-fns/collections/index.js'

const TILE_MODIFIER: Record<string, { local: string; global: string }> = {
  draft: { local: styles.tileDraft, global: 'byline-dashboard-tile-draft' },
  published: { local: styles.tilePublished, global: 'byline-dashboard-tile-published' },
  archived: { local: styles.tileArchived, global: 'byline-dashboard-tile-archived' },
}
const CUSTOM_TILE_MODIFIER = {
  local: styles.tileCustom,
  global: 'byline-dashboard-tile-custom',
}

function tileModifier(name: string) {
  return TILE_MODIFIER[name] ?? CUSTOM_TILE_MODIFIER
}

function StatTile({
  ws,
  count,
  collectionPath,
}: {
  ws: WorkflowStatus
  count: number
  collectionPath: string
}) {
  const modifier = tileModifier(ws.name)
  return (
    <Link
      to={getAdminRoutePath('collections', '$collection')}
      params={{ collection: collectionPath }}
      search={{ status: ws.name }}
      className={cx('byline-dashboard-stat-tile', styles.statTile, modifier.global, modifier.local)}
    >
      <span className={cx('byline-dashboard-stat-tile-label', styles.statTileLabel)}>
        {ws.label ?? ws.name}
      </span>
      <span className={cx('byline-dashboard-stat-tile-number', styles.statTileNumber)}>
        {count}
      </span>
    </Link>
  )
}

interface AdminDashboardProps {
  statsMap: Record<string, CollectionStatusCount[]>
}

export function AdminDashboard({ statsMap }: AdminDashboardProps) {
  const config = getClientConfig()
  const { t } = useTranslation('byline-admin')

  return (
    <Section>
      <Container>
        <div className={cx('byline-dashboard-grid', styles.grid)}>
          {config.collections.map((collection) => {
            const stats = statsMap[collection.path]
            const total = stats?.reduce((sum, s) => sum + s.count, 0) ?? 0
            const workflowStatuses = getWorkflowStatuses(collection)

            return (
              <Card key={collection.path}>
                <Link
                  to={getAdminRoutePath('collections', '$collection')}
                  params={{ collection: collection.path }}
                  className={cx('byline-dashboard-card-link', styles.cardLink)}
                >
                  <Card.Header>
                    <div className={cx('byline-dashboard-card-header', styles.cardHeader)}>
                      <Card.Title className={cx('byline-dashboard-card-title', styles.cardTitle)}>
                        <span className={cx('byline-dashboard-title-text', styles.titleText)}>
                          {collection.labels.plural}
                        </span>
                        <span className={cx('muted byline-dashboard-title-meta', styles.titleMeta)}>
                          {t('dashboard.totalCount', { count: total })}
                        </span>
                      </Card.Title>
                      <Card.Description className="muted">
                        {t('dashboard.collectionDescription', { label: collection.labels.plural })}
                      </Card.Description>
                    </div>
                  </Card.Header>
                </Link>
                <Card.Content>
                  {stats !== undefined ? (
                    <div className={cx('byline-dashboard-stat-grid', styles.statGrid)}>
                      {workflowStatuses.map((ws) => {
                        const entry = stats.find((s) => s.status === ws.name)
                        return (
                          <StatTile
                            key={ws.name}
                            ws={ws}
                            count={entry?.count ?? 0}
                            collectionPath={collection.path}
                          />
                        )
                      })}
                    </div>
                  ) : (
                    <Link
                      to={getAdminRoutePath('collections', '$collection')}
                      params={{ collection: collection.path }}
                      className={cx('byline-dashboard-empty-link', styles.emptyLink)}
                    >
                      <p>
                        {t('dashboard.collectionDescription', { label: collection.labels.plural })}
                      </p>
                    </Link>
                  )}
                </Card.Content>
              </Card>
            )
          })}
        </div>
      </Container>
    </Section>
  )
}
