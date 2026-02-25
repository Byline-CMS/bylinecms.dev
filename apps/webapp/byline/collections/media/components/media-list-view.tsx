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

import { Link, useNavigate, useRouterState } from '@tanstack/react-router'

import type { ListViewComponentProps, StoredFileValue, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import {
  Container,
  IconButton,
  LoaderRing,
  PlusIcon,
  Search,
  Section,
  Select,
  SelectItem,
} from '@infonomic/uikit/react'

import { RouterPager } from '@/ui/components/router-pager'
import { formatNumber } from '@/utils/utils.general'
import { FormatBadge } from './media-thumbnail'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the webp thumbnail URL from the original storage_url using the same
 * convention as MediaThumbnailCell / the Sharp upload processor.
 *   `/uploads/media/2026/02/img.jpg` → `/uploads/media/2026/02/img-thumbnail.webp`
 */
function deriveThumbnailUrl(storageUrl: string): string {
  return storageUrl.replace(/\.[^.]+$/, '-thumbnail.webp')
}

// ---------------------------------------------------------------------------
// Order-by config
// ---------------------------------------------------------------------------

/**
 * Composite order values that encode both `order` field and `desc` direction.
 * Format: `"<field>_<asc|desc>"` — split at the last underscore when applied.
 */
const ORDER_OPTIONS = [
  { value: 'updated_at_desc', label: 'Recently Updated' },
  { value: 'updated_at_asc', label: 'Oldest Updated' },
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'created_at_desc', label: 'Newest Created' },
  { value: 'created_at_asc', label: 'Oldest Created' },
] as const

type OrderValue = (typeof ORDER_OPTIONS)[number]['value']

function parseOrderValue(order?: string, desc?: boolean): OrderValue {
  if (!order) return 'updated_at_desc'
  const candidate = `${order}_${desc ? 'desc' : 'asc'}` as OrderValue
  return ORDER_OPTIONS.some((o) => o.value === candidate) ? candidate : 'updated_at_desc'
}

function splitOrderValue(value: OrderValue): { order: string; desc: boolean } {
  const i = value.lastIndexOf('_')
  return { order: value.slice(0, i), desc: value.slice(i + 1) === 'desc' }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stats({ total }: { total: number }) {
  return (
    <span className="flex items-center justify-center h-7 min-w-7 px-1.5 py-1.25 -mb-1 whitespace-nowrap text-sm leading-0 bg-gray-25 dark:bg-canvas-700 border rounded-md">
      {formatNumber(total, 0)}
    </span>
  )
}

function StatusBadge({
  status,
  workflowStatuses,
}: {
  status: string
  workflowStatuses: WorkflowStatus[]
}) {
  const label = workflowStatuses.find((s) => s.name === status)?.label ?? status
  const colour =
    status === 'published'
      ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
      : status === 'archived'
        ? 'bg-gray-500/15 text-gray-400 ring-gray-500/30'
        : 'bg-amber-500/15 text-amber-400 ring-amber-500/30'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colour}`}
    >
      {label}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
      <LoaderRing className="mb-4 opacity-0" size={1} color="transparent" />
      <p className="text-sm">No media items found.</p>
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
  const location = useRouterState({ select: (s) => s.location })
  const collectionPath = data.included.collection.path
  const search = location.search as Record<string, any>

  // ---- search ----

  const handleOnSearch = (query: string): void => {
    if (query != null && query.length > 0) {
      const params = structuredClone(search)
      delete params.page
      params.query = query
      navigate({
        to: '/admin/collections/$collection',
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
      to: '/admin/collections/$collection',
      params: { collection: collectionPath },
      search: params,
    })
  }

  // ---- order-by ----

  const currentOrder = parseOrderValue(search.order, search.desc)

  const handleOrderChange = (value: string): void => {
    const { order, desc } = splitOrderValue(value as OrderValue)
    const params = structuredClone(search)
    delete params.page
    params.order = order
    params.desc = desc
    navigate({
      to: '/admin/collections/$collection',
      params: { collection: collectionPath },
      search: params,
    })
  }

  // ---- render ----

  return (
    <Section>
      <Container>
        {/* ---- Header ---- */}
        <div className="flex items-center gap-3 py-0.5">
          <h1 className="m-0! pb-0.5">{data.included.collection.labels.plural as string}</h1>
          <Stats total={data.meta.total} />
          <IconButton aria-label="Upload New Media" asChild>
            <Link
              className="ml-auto"
              to="/admin/collections/$collection/create"
              params={{ collection: collectionPath }}
            >
              <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
            </Link>
          </IconButton>
        </div>

        {/* ---- Toolbar ---- */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap items-start sm:items-center mt-3 mb-4">
          <Search
            onSearch={handleOnSearch}
            onClear={handleOnClear}
            inputSize="sm"
            placeholder="Search media…"
            className="w-full max-w-87.5"
          />

          {/* Order-by */}
          <div className="flex items-center gap-2 sm:ml-auto">
            <label
              htmlFor="media_order"
              className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap"
            >
              Order by
            </label>
            <Select
              id="media_order"
              name="media_order"
              size="sm"
              value={currentOrder}
              onValueChange={handleOrderChange}
            >
              {ORDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </Select>
          </div>

          {/* Top pager */}
          <RouterPager
            lng="en"
            page={data.meta.page}
            count={data.meta.total_pages}
            showFirstButton
            showLastButton
            componentName="pagerTop"
            aria-label="Top Pager"
          />
        </div>

        {/* ---- Card grid ---- */}
        {data.documents.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6 mt-4">
            {(data.documents as any[]).map((doc) => {
              const img = doc.image as StoredFileValue | null | undefined
              const thumbUrl = img?.storage_url
                ? img.thumbnail_generated
                  ? deriveThumbnailUrl(img.storage_url)
                  : img.storage_url
                : null

              const updatedAt = doc.updated_at
                ? new Date(doc.updated_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: '2-digit',
                })
                : null

              return (
                <Link
                  key={doc.document_id}
                  to="/admin/collections/$collection/$id"
                  params={{ collection: collectionPath, id: doc.document_id }}
                  className="group flex flex-col overflow-hidden rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-canvas-800 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors no-underline"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-canvas-700">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={doc.altText ?? img?.original_filename ?? ''}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs text-gray-400 dark:text-gray-600">
                        No image
                      </span>
                    )}
                  </div>

                  {/* Card meta */}
                  <div className="flex flex-col gap-1.5 p-2 min-w-0">
                    <span
                      className="truncate text-sm font-medium leading-snug"
                      title={doc.title ?? ''}
                    >
                      {doc.title ?? '—'}
                    </span>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {doc.status && (
                          <StatusBadge status={doc.status} workflowStatuses={workflowStatuses} />
                        )}
                        {img?.image_format && <FormatBadge format={img.image_format} />}
                      </div>
                      {updatedAt && (
                        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                          {updatedAt}
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
        <div className="flex justify-end mb-5">
          <RouterPager
            smoothScrollToTop={true}
            lng="en"
            page={data.meta.page}
            count={data.meta.total_pages}
            showFirstButton
            showLastButton
            componentName="pagerBottom"
            aria-label="Bottom Pager"
          />
        </div>
      </Container>
    </Section>
  )
}
