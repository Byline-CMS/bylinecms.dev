/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * MediaListView — card-grid list view for the Media collection.
 *
 * Registered via `CollectionAdminConfig.listView` in MediaAdmin, replacing
 * the default table-based ListView. Receives the same paginated API data, so
 * no additional API parameters or endpoints are required.
 *
 * Controls:
 *  - Search bar (delegates to `?query=` URL param)
 *  - Order-by dropdown (maps to `?order=` + `?desc=` URL params)
 *  - Top + bottom pagination (RouterPager)
 */

import { useRouterState } from '@tanstack/react-router'

import { LocalDateTime } from '@byline/admin/react'
import type { ListViewComponentProps, StoredFileValue, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Link, useNavigate } from '@byline/host-tanstack-start/admin-shell/chrome/loose-router'
import { RouterPager } from '@byline/host-tanstack-start/admin-shell/chrome/router-pager'
import { getAdminRoutePath } from '@byline/host-tanstack-start/routes/admin-path'
import { useTranslation } from '@byline/i18n/react'
import {
  Container,
  IconButton,
  LoaderRing,
  PlusIcon,
  Search,
  Section,
  Select,
} from '@byline/ui/react'

import { MEDIA_ADMIN_NAMESPACE } from '../i18n/index.js'
import styles from './media-list-view.module.css'
import { FormatBadge } from './media-thumbnail'

function formatNumber(number: number, decimalPlaces: number) {
  if (typeof number !== 'number' || Number.isNaN(number)) {
    throw new TypeError('Input must be a valid number')
  }

  const options = {
    minimumFractionDigits: decimalPlaces !== undefined ? decimalPlaces : 0,
    maximumFractionDigits: decimalPlaces !== undefined ? decimalPlaces : 20,
  }

  return number.toLocaleString('en-US', options)
}

// ---------------------------------------------------------------------------
// Order-by config
// ---------------------------------------------------------------------------

/**
 * Composite order values that encode both `order` field and `desc` direction.
 * Format: `"<field>_<asc|desc>"` — split at the last underscore when applied.
 *
 * Labels are resolved at render time via `useTranslation('webapp-media-admin')`
 * — the `value` strings stay code-stable so they can serve as URL params.
 */
const ORDER_VALUES = [
  'updated_at_desc',
  'updated_at_asc',
  'title_asc',
  'title_desc',
  'created_at_desc',
  'created_at_asc',
] as const

type OrderValue = (typeof ORDER_VALUES)[number]

const ORDER_LABEL_KEYS: Record<OrderValue, string> = {
  updated_at_desc: 'order.recentlyUpdated',
  updated_at_asc: 'order.oldestUpdated',
  title_asc: 'order.titleAsc',
  title_desc: 'order.titleDesc',
  created_at_desc: 'order.newestCreated',
  created_at_asc: 'order.oldestCreated',
}

function parseOrderValue(order?: string, desc?: boolean): OrderValue {
  if (!order) return 'updated_at_desc'
  const candidate = `${order}_${desc ? 'desc' : 'asc'}` as OrderValue
  return (ORDER_VALUES as readonly string[]).includes(candidate) ? candidate : 'updated_at_desc'
}

function splitOrderValue(value: OrderValue): { order: string; desc: boolean } {
  const i = value.lastIndexOf('_')
  return { order: value.slice(0, i), desc: value.slice(i + 1) === 'desc' }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stats({ total }: { total: number }) {
  return <span className={styles.stats}>{formatNumber(total, 0)}</span>
}

function statusClassName(status: string): string {
  if (status === 'published') return styles['status-published']
  if (status === 'archived') return styles['status-archived']
  return styles['status-default']
}

function StatusBadge({
  status,
  workflowStatuses,
}: {
  status: string
  workflowStatuses: WorkflowStatus[]
}) {
  const label = workflowStatuses.find((s) => s.name === status)?.label ?? status
  return <span className={`${styles['status-badge']} ${statusClassName(status)}`}>{label}</span>
}

function EmptyState() {
  const { t } = useTranslation(MEDIA_ADMIN_NAMESPACE)
  return (
    <div className={styles['empty-state']}>
      <LoaderRing className={styles['empty-loader']} size={1} color="transparent" />
      <p className={styles['empty-text']}>{t('empty')}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MediaListView
// ---------------------------------------------------------------------------

export function MediaListView({
  data,
  workflowStatuses = [],
}: ListViewComponentProps<AnyCollectionSchemaTypes['ListType']>) {
  const navigate = useNavigate()
  const { t } = useTranslation(MEDIA_ADMIN_NAMESPACE)
  const location = useRouterState({ select: (s) => s.location })
  const collectionPath = data.included.collection.path
  const search = location.search as Record<string, any>

  // Sort-option labels resolved per-render so the Select reflects the
  // active interface locale. `value` strings are URL params and stay
  // code-stable — see ORDER_VALUES.
  const orderItems = ORDER_VALUES.map((value) => ({
    value,
    label: t(ORDER_LABEL_KEYS[value]),
  }))

  // ---- search ----

  const handleOnSearch = (query: string): void => {
    if (query != null && query.length > 0) {
      const params = structuredClone(search)
      delete params.page
      params.query = query
      navigate({
        to: getAdminRoutePath('collections', '$collection'),
        params: { collection: collectionPath },
        search: params,
      })
    }
  }

  const handleOnClear = (): void => {
    const params = structuredClone(search)
    delete params.page
    delete params.query
    navigate({
      to: getAdminRoutePath('collections', '$collection'),
      params: { collection: collectionPath },
      search: params,
    })
  }

  // ---- order-by ----

  const currentOrder = parseOrderValue(search.order, search.desc)

  const handleOrderChange = (value: string | null): void => {
    if (value == null) return
    const { order, desc } = splitOrderValue(value as OrderValue)
    const params = structuredClone(search)
    delete params.page
    params.order = order
    params.desc = desc
    navigate({
      to: getAdminRoutePath('collections', '$collection'),
      params: { collection: collectionPath },
      search: params,
    })
  }

  // ---- render ----

  return (
    <Section>
      <Container>
        {/* ---- Header ---- */}
        <div className={styles.header}>
          <h1 className={styles.heading}>{data.included.collection.labels.plural as string}</h1>
          <Stats total={data.meta.total} />
          <IconButton
            aria-label={t('header.uploadAriaLabel')}
            render={
              <Link
                className={styles['create-link']}
                to={getAdminRoutePath('collections', '$collection', 'create')}
                params={{ collection: collectionPath }}
              />
            }
          >
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>

        {/* ---- Toolbar ---- */}
        <div className={styles.toolbar}>
          <Search
            onSearch={handleOnSearch}
            onClear={handleOnClear}
            inputSize="sm"
            placeholder={t('toolbar.searchPlaceholder')}
            className={styles.search}
          />

          {/* Order-by */}
          <div className={styles['order-group']}>
            <label htmlFor="media_order" className={styles['order-label']}>
              {t('toolbar.orderByLabel')}
            </label>
            <Select
              id="media_order"
              name="media_order"
              size="sm"
              value={currentOrder}
              onValueChange={handleOrderChange}
              items={orderItems}
            />
          </div>

          {/* Top pager */}
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="pagerTop"
            aria-label={t('toolbar.pagerTopAriaLabel')}
          />
        </div>

        {/* ---- Card grid ---- */}
        {data.docs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className={styles.grid}>
            {(data.docs as any[]).map((doc) => {
              const fields = doc.fields ?? {}
              const img = fields.image as StoredFileValue | null | undefined
              const thumbVariant = img?.variants?.find((v) => v.name === 'thumbnail')
              const thumbUrl = thumbVariant?.storageUrl ?? img?.storageUrl ?? null

              const updatedAt = doc.updatedAt ?? null

              return (
                <Link
                  key={doc.id}
                  to={getAdminRoutePath('collections', '$collection', '$id')}
                  params={{ collection: collectionPath, id: doc.id }}
                  className={styles.card}
                >
                  {/* Thumbnail */}
                  <div className={styles['thumb-wrap']}>
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={fields.altText ?? img?.originalFilename ?? ''}
                        className={styles['thumb-img']}
                        loading="lazy"
                      />
                    ) : (
                      <span className={styles['thumb-placeholder']}>{t('card.noImage')}</span>
                    )}
                  </div>

                  {/* Card meta */}
                  <div className={styles['card-meta']}>
                    <span className={styles['card-title']} title={fields.title ?? ''}>
                      {fields.title ?? '—'}
                    </span>
                    <div className={styles['card-meta-row']}>
                      <div className={styles.badges}>
                        {doc.status && (
                          <StatusBadge status={doc.status} workflowStatuses={workflowStatuses} />
                        )}
                        {img?.imageFormat && <FormatBadge format={img.imageFormat} />}
                      </div>
                      {updatedAt && (
                        <span className={styles['updated-at']}>
                          <LocalDateTime value={updatedAt} mode="date" />
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* ---- Bottom pagination ---- */}
        <div className={styles['bottom-pager']}>
          <RouterPager
            smoothScrollToTop={true}
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="pagerBottom"
            aria-label={t('toolbar.pagerBottomAriaLabel')}
          />
        </div>
      </Container>
    </Section>
  )
}
