'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useMemo, useState } from 'react'

import type { TabDefinition, TabSetDefinition } from '@byline/core'

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
  activeTabBySet: Record<string, string>
): UseFormTabsResult {
  const { errors: initialErrors, subscribeErrors, subscribeMeta, getFieldValues } = useFormContext()

  const [errors, setErrors] = useState(initialErrors)
  useEffect(() => {
    return subscribeErrors((newErrors) => setErrors(newErrors))
  }, [subscribeErrors])

  // Live form data, so TabDefinition.condition re-evaluates per keystroke.
  const [formData, setFormData] = useState<Record<string, any>>(() => getFieldValues())
  useEffect(() => {
    return subscribeMeta(() => setFormData(getFieldValues()))
  }, [subscribeMeta, getFieldValues])

  // Per-tab-set error counts: { [tabSetName]: { [tabName]: count } }.
  // Each tab bar consumes its own slice.
  const errorCountsBySet = useMemo<Record<string, Record<string, number>>>(() => {
    const result: Record<string, Record<string, number>> = {}
    for (const err of errors) {
      const path = fieldToTabPath.get(err.field)
      if (!path) continue
      result[path.tabSetName] ??= {}
      result[path.tabSetName]![path.tabName] = (result[path.tabSetName]?.[path.tabName] ?? 0) + 1
    }
    return result
  }, [errors, fieldToTabPath])

  const resolve = (set: TabSetDefinition): ResolvedTabSet => {
    const visibleTabs = set.tabs.filter((tab) => !tab.condition || tab.condition(formData))
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
