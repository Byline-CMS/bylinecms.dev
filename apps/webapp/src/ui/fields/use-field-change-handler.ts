/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback } from 'react'

import type { Field, FieldBeforeChangeResult, FieldHookContext } from '@byline/core'

import { useFormContext } from './form-context'

/**
 * Returns a change handler for the given field that runs through the
 * field-hook pipeline before committing the value:
 *
 *   1. `clearFieldError(path)`
 *   2. `field.hooks.beforeValidate(ctx)` — may return `{ error }` to block
 *   3. `field.hooks.beforeChange(ctx)` — may return `{ value }` to replace
 *      or `{ error }` to block
 *   4. `setFieldValue(path, finalValue)`
 *
 * When the field has no hooks the function is a zero-overhead pass-through
 * to `setFieldValue` (no promises, no extra allocations).
 */
export function useFieldChangeHandler(field: Field, path: string) {
  const { setFieldValue, getFieldValue, getFieldValues, setFieldError, clearFieldError } =
    useFormContext()

  return useCallback(
    (value: any) => {
      const hooks = field.hooks

      // ── fast path: no hooks defined ────────────────────────────
      if (!hooks?.beforeValidate && !hooks?.beforeChange) {
        setFieldValue(path, value)
        return
      }

      // ── slow path: run async hook pipeline ─────────────────────
      const previousValue = getFieldValue(path)
      const ctx: FieldHookContext = {
        value,
        previousValue,
        data: getFieldValues(),
        path,
        field,
      }

      clearFieldError(path)

      void (async () => {
        try {
          // 1. beforeValidate
          if (hooks?.beforeValidate) {
            const result = (await hooks.beforeValidate(ctx)) as FieldBeforeChangeResult | undefined
            if (result?.error) {
              setFieldError(path, result.error)
              return // block the change
            }
            // Allow beforeValidate to transform the value too
            if (result?.value !== undefined) {
              ctx.value = result.value
            }
          }

          // 2. beforeChange
          if (hooks?.beforeChange) {
            const result = (await hooks.beforeChange(ctx)) as FieldBeforeChangeResult | undefined
            if (result?.error) {
              setFieldError(path, result.error)
              return // block the change
            }
            if (result?.value !== undefined) {
              ctx.value = result.value
            }
          }

          // 3. commit
          setFieldValue(path, ctx.value)
        } catch (err) {
          // Surface unexpected hook errors as field errors rather than crashing
          const message = err instanceof Error ? err.message : 'Unexpected hook error'
          setFieldError(path, message)
        }
      })()
    },
    // field reference is stable per render cycle; path is derived from props
    [field, path, setFieldValue, getFieldValue, getFieldValues, setFieldError, clearFieldError]
  )
}
