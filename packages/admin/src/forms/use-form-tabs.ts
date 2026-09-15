'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { parseInstancePath, type TabDefinition, type TabSetDefinition } from '@byline/core'

import { useFormContext } from './form-context'

/** One tab set, resolved against live form data and current errors. */
export interface ResolvedTabSet {
  /** Tabs whose `condition` is satisfied, in declaration order. */
  visibleTabs: TabDefinition[]
  /** The tab that should render, after falling back off a hidden selection. */
  activeTabName: string
  activeTab: TabDefinition | undefined
  /** Error count per tab name, for the tab bar's badges. */
  errorCounts: Record<string, number> | undefined
}

export interface UseFormTabsResult {
  resolve: (set: TabSetDefinition) => ResolvedTabSet
  errorCountsBySet: Record<string, Record<string, number>>
}

/**
 * Tab visibility, per-tab error counts, and fallback when the selected tab is
 * hidden.
 *
 * It deliberately does **not** own the selection. `FormRenderer` lifts that
 * above the keyed `FormProvider` so the editor's tab choices survive the
 * remount a locale change triggers; a hook living inside that subtree would
 * lose them on every switch. The selection arrives as `activeTabBySet` and
 * changes are reported upward.
 */
export function useFormTabs(
  fieldToTabPath: Map<string, { tabSetName: string; tabName: string }>,
  activeTabBySet: Record<string, string>,
  tabSets: TabSetDefinition[]
): UseFormTabsResult {
  const { getErrors, subscribeErrors, subscribeMeta, getFieldValues } = useFormContext()
  const errors = useSyncExternalStore(subscribeErrors, getErrors, getErrors)
  const conditionalTabs = useMemo(
    () => tabSets.flatMap((set) => set.tabs.filter((tab) => tab.condition)),
    [tabSets]
  )
  const snapshot = useCallback(
    () => JSON.stringify(conditionalTabs.map((tab) => Boolean(tab.condition?.(getFieldValues())))),
    [conditionalTabs, getFieldValues]
  )
  const subscribe = useCallback(
    (notify: () => void) => (conditionalTabs.length ? subscribeMeta(notify) : () => {}),
    [conditionalTabs, subscribeMeta]
  )
  useSyncExternalStore(subscribe, snapshot, snapshot)

  // Per-tab-set error counts: { [tabSetName]: { [tabName]: count } }.
  // Each tab bar consumes its own slice.
  const errorCountsBySet = useMemo<Record<string, Record<string, number>>>(() => {
    const result: Record<string, Record<string, number>> = {}
    for (const err of errors) {
      const parsed = parseInstancePath(err.field)
      const root = parsed.ok ? parsed.segments[0] : undefined
      const path =
        fieldToTabPath.get(err.field) ??
        (root?.kind === 'field' ? fieldToTabPath.get(root.name) : undefined)
      if (!path) continue
      result[path.tabSetName] ??= {}
      result[path.tabSetName]![path.tabName] = (result[path.tabSetName]?.[path.tabName] ?? 0) + 1
    }
    return result
  }, [errors, fieldToTabPath])

  const resolve = (set: TabSetDefinition): ResolvedTabSet => {
    const visibleTabs = set.tabs.filter((tab) => !tab.condition || tab.condition(getFieldValues()))
    const requested = activeTabBySet[set.name] ?? ''
    const activeTabName =
      visibleTabs.length > 0 && !visibleTabs.some((t) => t.name === requested)
        ? (visibleTabs[0]?.name ?? requested)
        : requested
    return {
      visibleTabs,
      activeTabName,
      activeTab: visibleTabs.find((t) => t.name === activeTabName),
      errorCounts: errorCountsBySet[set.name],
    }
  }

  return { resolve, errorCountsBySet }
}
