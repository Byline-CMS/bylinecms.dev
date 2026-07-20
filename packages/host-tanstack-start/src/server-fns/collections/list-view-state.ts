/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure precedence resolver for the collection list view's page size and
 * sort — extracted from the list server fn so the chain is testable
 * without a database:
 *
 *   URL params → user preference → configured defaultSort → storage
 *   default (created_at desc, expressed as "no sort spec")
 *
 * `orderable: true` collections sort by the drag order (`order_key asc`)
 * and never take sort preferences or a configured default — but explicit
 * URL params still win (a shared sorted link opens as sent), and a
 * page-size preference still applies.
 *
 * A preference `order` naming a field that is no longer sortable on the
 * collection is skipped (not an error): the schema may have moved on
 * since the preference was written.
 */

export interface ListViewPreferenceValue {
  page_size?: number
  order?: string
  desc?: boolean
}

export interface ResolveListViewStateInput {
  params: { page_size?: number; order?: string; desc?: boolean }
  preference: ListViewPreferenceValue | null
  orderable: boolean
  /** Field names valid as a sort column (collection fields + system columns). */
  sortableFields: string[]
  configuredSort?: { order: string; desc: boolean }
}

export interface ResolvedListViewState {
  pageSize: number
  /** Sort spec for `CollectionHandle.find`; undefined → storage default. */
  sort?: Record<string, 'asc' | 'desc'>
  /** Effective sort echoed through `meta.order` / `meta.desc` for the header indicator. */
  metaOrder?: string
  metaDesc?: boolean
}

export function resolveListViewState(input: ResolveListViewStateInput): ResolvedListViewState {
  const { params, preference, orderable, sortableFields, configuredSort } = input

  // Defensive clamp at read time — the write path validates 1–100, but a
  // hand-edited row must degrade to the default, not a absurd page.
  const rawPrefPageSize = preference?.page_size
  const prefPageSize =
    typeof rawPrefPageSize === 'number' &&
    Number.isInteger(rawPrefPageSize) &&
    rawPrefPageSize >= 1 &&
    rawPrefPageSize <= 100
      ? rawPrefPageSize
      : undefined
  const pageSize = params.page_size ?? prefPageSize ?? 20

  // Explicit URL params always win. Semantics preserved from the original
  // inline code: an omitted `desc` alongside an explicit `order` sorts
  // descending, and the meta echo passes the raw param values through.
  if (params.order) {
    return {
      pageSize,
      sort: { [params.order]: params.desc === false ? 'asc' : 'desc' },
      metaOrder: params.order,
      metaDesc: params.desc,
    }
  }

  if (orderable) {
    return { pageSize, sort: { order_key: 'asc' } }
  }

  const rawPrefOrder = preference?.order
  const prefOrder =
    typeof rawPrefOrder === 'string' && sortableFields.includes(rawPrefOrder)
      ? rawPrefOrder
      : undefined
  if (prefOrder != null) {
    const desc = preference?.desc === true
    return {
      pageSize,
      sort: { [prefOrder]: desc ? 'desc' : 'asc' },
      metaOrder: prefOrder,
      metaDesc: desc,
    }
  }

  if (configuredSort != null) {
    return {
      pageSize,
      sort: { [configuredSort.order]: configuredSort.desc ? 'desc' : 'asc' },
      metaOrder: configuredSort.order,
      metaDesc: configuredSort.desc,
    }
  }

  return { pageSize }
}
