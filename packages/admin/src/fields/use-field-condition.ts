/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useState } from 'react'

import type { Field } from '@byline/core'

import { useFormContext } from '../forms/form-context'
import { get as getNestedValue } from '../forms/nested-path'

/**
 * Evaluate a field's visibility `condition` against live form data.
 *
 * Subscribes to the form's meta listeners — fired on every field commit, the
 * same loop `TabDefinition.condition` rides — and recomputes the predicate.
 * The consumer only re-renders when the boolean actually flips, so a stable
 * condition costs one function call per form edit, no reconciliation.
 *
 * `basePath` is the field's sibling scope: the enclosing group / array item
 * (e.g. `files[0].filesGroup` for `files[0].filesGroup.thumbnailPage`).
 * Root-level fields pass no basePath and receive the full form data as their
 * sibling scope, mirroring `FieldCondition`'s contract.
 *
 * Fields without a condition are always visible and no subscription is made.
 *
 * A condition that throws leaves the field visible. It runs on every form edit
 * against live, partly-filled data, so a predicate that assumes a shape the
 * editor has not reached yet would otherwise take the render down. Failing
 * closed keeps the field editable and matches the validation walker, which
 * treats the same failure as visible-and-invalid. The misconfiguration is
 * reported once per field rather than on every keystroke.
 */
const reportedConditionFailures = new WeakSet<Field>()
export const useFieldCondition = (field: Field, basePath?: string): boolean => {
  const { getFieldValues, subscribeMeta } = useFormContext()

  const evaluate = useCallback((): boolean => {
    if (!field.condition) return true
    const data = getFieldValues()
    const siblingData = basePath ? (getNestedValue(data, basePath) ?? {}) : data
    try {
      return Boolean(field.condition(data, siblingData))
    } catch (error) {
      if (!reportedConditionFailures.has(field)) {
        reportedConditionFailures.add(field)
        console.error(`Field condition threw for '${field.name}'; keeping the field visible`, error)
      }
      return true
    }
  }, [field, basePath, getFieldValues])

  const [visible, setVisible] = useState<boolean>(evaluate)

  useEffect(() => {
    if (!field.condition) return undefined
    // Re-evaluate on (re)subscribe as well as on every subsequent form edit —
    // the store may have changed between the initial render and this effect.
    setVisible(evaluate())
    return subscribeMeta(() => setVisible(evaluate()))
  }, [field.condition, subscribeMeta, evaluate])

  return visible
}
