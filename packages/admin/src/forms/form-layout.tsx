'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Fragment, type ReactNode } from 'react'

import type {
  AdminResourceConfig,
  Field,
  GroupDefinition,
  RowDefinition,
  TabSetDefinition,
} from '@byline/core'
import cx from 'clsx'

import { sliceFieldAdmin } from '../fields/field-admin'
import { FieldRenderer } from '../fields/field-renderer'
import { AdminGroup } from '../presentation/group'
import { AdminRow } from '../presentation/row'
import { AdminTabs, tabPanelId, tabTriggerId } from '../presentation/tabs'
import styles from './form-renderer.module.css'
import { useFormLayout } from './use-form-layout'
import { useFormTabs } from './use-form-tabs'

export interface FormLayoutProps {
  fields: Field[]
  adminConfig?: AdminResourceConfig
  /** Which regions to render, in order. Default: both. */
  regions?: ReadonlyArray<'main' | 'sidebar'>
  /** 'split' = two columns (full page); 'stacked' = one column (embedded). */
  variant?: 'split' | 'stacked'
  collectionPath?: string
  /** Content locale passed through to every field renderer. */
  activeLocale?: string
  /** Initial document, for field default values. */
  // biome-ignore lint/suspicious/noExplicitAny: document shape is collection-specific
  initialData?: any
  /**
   * Controlled active-tab state. Owned above the keyed `FormProvider` so tab
   * choices survive the remount a locale change triggers — see `useFormTabs`.
   */
  activeTabBySet: Record<string, string>
  onTabChange: (tabSetName: string, tabName: string) => void
  /**
   * Page-level sidebar widgets (path, tree placement, available locales),
   * rendered in the same sidebar column as the sidebar schema fields. The
   * embedded creation view passes nothing.
   */
  sidebarSlot?: ReactNode
}

const BOTH_REGIONS = ['main', 'sidebar'] as const

/**
 * The layout walk: recursively dispatches each name in a region to the
 * appropriate primitive renderer or to `<FieldRenderer>`.
 */
export const FormLayout = ({
  fields,
  adminConfig,
  regions = BOTH_REGIONS,
  variant = 'split',
  activeLocale,
  initialData,
  activeTabBySet,
  onTabChange,
  sidebarSlot,
}: FormLayoutProps): ReactNode => {
  const { fieldByName, tabSetByName, rowByName, groupByName, layout, fieldToTabPath } =
    useFormLayout(adminConfig, fields)
  const tabs = useFormTabs(fieldToTabPath, activeTabBySet)

  const renderField = (fieldName: string): ReactNode => {
    const field = fieldByName.get(fieldName)
    if (!field) return null
    return (
      <FieldRenderer
        key={field.name}
        field={field}
        defaultValue={initialData?.fields?.[field.name]}
        contentLocale={activeLocale}
        components={adminConfig?.fields?.[field.name]?.components}
        editor={adminConfig?.fields?.[field.name]?.editor}
        fieldAdmin={sliceFieldAdmin(adminConfig?.fields, field.name)}
      />
    )
  }

  const renderItem = (name: string): ReactNode => {
    const tabSet = tabSetByName.get(name)
    if (tabSet) return renderTabSet(tabSet)

    const group = groupByName.get(name)
    if (group) return renderGroup(group)

    const row = rowByName.get(name)
    if (row) return renderRow(row)

    return renderField(name)
  }

  const renderRow = (row: RowDefinition): ReactNode => (
    <AdminRow key={`row:${row.name}`}>{row.fields.map((name) => renderField(name))}</AdminRow>
  )

  const renderGroup = (group: GroupDefinition): ReactNode => (
    <AdminGroup key={`group:${group.name}`} label={group.label}>
      {group.fields.map((name) => renderItem(name))}
    </AdminGroup>
  )

  const renderTabSet = (set: TabSetDefinition): ReactNode => {
    const { visibleTabs, activeTabName, activeTab, errorCounts } = tabs.resolve(set)
    const idBase = `tabset:${set.name}`

    return (
      <div key={idBase} className={cx('byline-form-tabset', styles.tabset)}>
        {visibleTabs.length > 0 && (
          <AdminTabs
            idBase={idBase}
            tabs={visibleTabs}
            activeTab={activeTabName}
            onChange={(tabName) => onTabChange(set.name, tabName)}
            errorCounts={errorCounts}
            className={cx('byline-form-tabset-tabs', styles['tabset-tabs'])}
          />
        )}
        {activeTab && (
          <div
            role="tabpanel"
            id={tabPanelId(idBase, activeTab.name)}
            aria-labelledby={tabTriggerId(idBase, activeTab.name)}
            className={cx('byline-form-tabset-fields', styles['tabset-fields'])}
          >
            {activeTab.fields.map((name) => renderItem(name))}
          </div>
        )}
      </div>
    )
  }

  const sidebarNames = layout.sidebar ?? []

  // Page-level widgets come first, matching the current editor. The plan's
  // Task 2 sketch had them after the schema fields; that would visibly reorder
  // a shipped collection's sidebar during a refactor whose acceptance is
  // behaviour preservation.
  const sidebarContents = (
    <>
      {sidebarSlot}
      {sidebarNames.map((name) => renderItem(name))}
    </>
  )

  // `regions` is an ordered list, not a set: iterate it in sequence rather than
  // testing membership, or a caller asking for ['sidebar', 'main'] silently
  // still gets main first.
  const renderRegion = (region: 'main' | 'sidebar'): ReactNode =>
    region === 'main' ? (
      <div key="main" className={cx('byline-form-content', styles.content)}>
        {layout.main.map((name) => renderItem(name))}
      </div>
    ) : (
      <div key="sidebar" className={cx('byline-form-sidebar', styles.sidebar)}>
        {sidebarContents}
      </div>
    )

  // Stacked: one column, both regions inline, and deliberately **not** the
  // split layout class - that class becomes a two-column grid at >=60rem, so
  // carrying it here would reserve an empty second track and narrow the only
  // column. Removing the sidebar element does not remove the grid track.
  if (variant === 'stacked') {
    return (
      <div className={cx('byline-form-layout-stacked', styles['layout-stacked'])}>
        <div className={cx('byline-form-content', styles.content)}>
          {regions.map((region) => (
            <Fragment key={region}>
              {region === 'main' ? layout.main.map((name) => renderItem(name)) : sidebarContents}
            </Fragment>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={cx('byline-form-layout', styles.layout)}>
      {regions.map((region) => renderRegion(region))}
    </div>
  )
}
