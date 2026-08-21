/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, WorkflowStatus } from '@byline/core'
import {
  filterReadableCollections,
  getAdminConfig,
  getWorkflowStatuses,
  groupCollectionsForAdmin,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Card, Container, Section } from '@byline/ui/react'
import cx from 'clsx'

import { useAbilities } from '../../integrations/abilities.jsx'
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

function CollectionCard({
  collection,
  stats,
}: {
  collection: CollectionDefinition
  stats: CollectionStatusCount[] | undefined
}) {
  const { t } = useTranslation('byline-admin')
  // `stats` is undefined when the collection opted out of counts (no
  // `showStats: true` on the definition) — the dashboard loader only fetches
  // them for collections that opted in. Falling back to a total of zero there
  // would read as "this collection is empty", so the count is omitted along
  // with the status tiles.
  const total = stats !== undefined ? stats.reduce((sum, s) => sum + s.count, 0) : undefined
  const workflowStatuses = getWorkflowStatuses(collection)

  return (
    <Card>
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
              {total !== undefined && (
                <span className={cx('muted byline-dashboard-title-meta', styles.titleMeta)}>
                  {t('dashboard.totalCount', { count: total })}
                </span>
              )}
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
            <p>{t('dashboard.collectionDescription', { label: collection.labels.plural })}</p>
          </Link>
        )}
      </Card.Content>
    </Card>
  )
}

interface AdminDashboardProps {
  statsMap: Record<string, CollectionStatusCount[]>
}

export function AdminDashboard({ statsMap }: AdminDashboardProps) {
  const config = getAdminConfig()
  const { t } = useTranslation('byline-admin')
  const { isSuperAdmin, abilities } = useAbilities()

  // Filter before bucketing. A group left with no readable members arrives at
  // `groupCollectionsForAdmin` empty and is skipped, so its heading disappears
  // along with it — there is no group-level ability concept anywhere.
  const visible = filterReadableCollections(config.collections, { isSuperAdmin, abilities })
  const buckets = groupCollectionsForAdmin(visible, config.admin, config.collectionGroups)

  if (buckets.length === 0) {
    return (
      <Section>
        <Container>
          <p className="muted">{t('dashboard.noCollections')}</p>
        </Container>
      </Section>
    )
  }

  return (
    <Section>
      <Container>
        {buckets.map((bucket) => (
          <section
            key={bucket.name ?? '__ungrouped__'}
            className={cx('byline-dashboard-group', styles.group)}
          >
            {bucket.label !== null && (
              <h2 className={cx('byline-dashboard-group-heading', styles.groupHeading)}>
                {bucket.label}
              </h2>
            )}
            <div className={cx('byline-dashboard-grid', styles.grid)}>
              {bucket.collections.map((collection) => (
                <CollectionCard
                  key={collection.path}
                  collection={collection}
                  stats={statsMap[collection.path]}
                />
              ))}
            </div>
          </section>
        ))}
      </Container>
    </Section>
  )
}
