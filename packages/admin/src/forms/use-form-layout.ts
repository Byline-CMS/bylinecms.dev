'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo } from 'react'

import type {
  CollectionAdminConfig,
  Field,
  GroupDefinition,
  LayoutDefinition,
  RowDefinition,
  TabSetDefinition,
} from '@byline/core'

/** Which tab set + tab a schema field is placed under. */
export interface TabPath {
  tabSetName: string
  tabName: string
}

/**
 * Derived lookup tables that drive the form's layout walk and per-tab error
 * badges. All are pure derivations of `adminConfig` + `fields`; the startup
 * validator guarantees every reachable name resolves and every schema field is
 * placed at most once, so the consuming render-time lookups stay unguarded.
 */
export interface FormLayout {
  /** Schema field name → field definition. */
  fieldByName: Map<string, Field>
  tabSetByName: Map<string, TabSetDefinition>
  rowByName: Map<string, RowDefinition>
  groupByName: Map<string, GroupDefinition>
  /** Region placement; synthesised to `{ main: <all fields> }` when omitted. */
  layout: LayoutDefinition
  /** Reverse index: schema field name → which tab set + tab it lives in. */
  fieldToTabPath: Map<string, TabPath>
}

/**
 * Build the reverse index from schema field name to its enclosing tab set +
 * tab. Fields not under any tab set (e.g. raw-field placement directly in
 * `layout.main`) are absent from the map. Rows and groups are recursed into;
 * the `seen` set guards against a config that references a row/group cycle.
 */
export function buildFieldToTabPath(
  adminConfig: CollectionAdminConfig | undefined,
  fieldByName: Map<string, Field>,
  rowByName: Map<string, RowDefinition>,
  groupByName: Map<string, GroupDefinition>
): Map<string, TabPath> {
  const map = new Map<string, TabPath>()
  const visit = (
    names: readonly string[],
    tabSetName: string,
    tabName: string,
    seen: Set<string>
  ) => {
    for (const name of names) {
      if (fieldByName.has(name)) {
        map.set(name, { tabSetName, tabName })
      } else if (seen.has(name)) {
      } else if (rowByName.has(name)) {
        const row = rowByName.get(name)!
        const next = new Set(seen).add(name)
        visit(row.fields, tabSetName, tabName, next)
      } else if (groupByName.has(name)) {
        const group = groupByName.get(name)!
        const next = new Set(seen).add(name)
        visit(group.fields, tabSetName, tabName, next)
      }
    }
  }
  for (const set of adminConfig?.tabSets ?? []) {
    for (const tab of set.tabs) {
      visit(tab.fields, set.name, tab.name, new Set())
    }
  }
  return map
}

/**
 * Memoise the layout primitives + lookup tables the form renderer walks.
 * Rebuilt only when `adminConfig` / `fields` change.
 */
export function useFormLayout(
  adminConfig: CollectionAdminConfig | undefined,
  fields: Field[]
): FormLayout {
  const fieldByName = useMemo(() => {
    const map = new Map<string, Field>()
    for (const field of fields) {
      if ('name' in field) map.set(field.name, field)
    }
    return map
  }, [fields])

  const tabSetByName = useMemo(() => {
    const map = new Map<string, TabSetDefinition>()
    for (const set of adminConfig?.tabSets ?? []) map.set(set.name, set)
    return map
  }, [adminConfig])

  const rowByName = useMemo(() => {
    const map = new Map<string, RowDefinition>()
    for (const row of adminConfig?.rows ?? []) map.set(row.name, row)
    return map
  }, [adminConfig])

  const groupByName = useMemo(() => {
    const map = new Map<string, GroupDefinition>()
    for (const group of adminConfig?.groups ?? []) map.set(group.name, group)
    return map
  }, [adminConfig])

  // When `layout` is omitted, synthesise main = all schema fields in order.
  const layout = useMemo<LayoutDefinition>(() => {
    if (adminConfig?.layout) return adminConfig.layout
    return { main: fields.filter((f) => 'name' in f).map((f) => (f as { name: string }).name) }
  }, [adminConfig, fields])

  const fieldToTabPath = useMemo(
    () => buildFieldToTabPath(adminConfig, fieldByName, rowByName, groupByName),
    [adminConfig, fieldByName, rowByName, groupByName]
  )

  return { fieldByName, tabSetByName, rowByName, groupByName, layout, fieldToTabPath }
}
