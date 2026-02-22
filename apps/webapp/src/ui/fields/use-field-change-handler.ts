/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback } from 'react'

import type { Field, FieldBeforeChangeResult, FieldHookContext } from '@byline/core'
import { normalizeHooks } from '@byline/core'

import { useFormContext } from './form-context'

/**
 * Returns a change handler for the given field that runs through the
 * field-hook pipeline before committing the value:
 *
 *   1. `clearFieldError(path)`
 *   2. `field.hooks.beforeValidate(ctx)` — advisory: may set an error on
 *      the field but the value is **always** committed (user can keep typing)
 *   3. `field.hooks.beforeChange(ctx)` — may return `{ value }` to replace
 *      or `{ error }` to block the change entirely
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
      const validateFns = normalizeHooks(hooks?.beforeValidate)
      const changeFns = normalizeHooks(hooks?.beforeChange)

      if (validateFns.length === 0 && changeFns.length === 0) {
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
        operation: 'change',
      }

      clearFieldError(path)

      void (async () => {
        try {
          // 1. beforeValidate (advisory — value is always committed)
          let advisoryError: string | undefined
          for (const fn of validateFns) {
            const result = (await fn(ctx)) as FieldBeforeChangeResult | undefined
            if (result?.error) {
              advisoryError = result.error
            }
            if (result?.value !== undefined) {
              ctx.value = result.value
            }
          }

          // 2. beforeChange
          for (const fn of changeFns) {
            const result = (await fn(ctx)) as FieldBeforeChangeResult | undefined
            if (result?.error) {
              setFieldError(path, result.error)
              return // block the change
            }
            if (result?.value !== undefined) {
              ctx.value = result.value
            }
          }

          // 3. commit the value, then surface any advisory error
          setFieldValue(path, ctx.value)
          if (advisoryError) {
            setFieldError(path, advisoryError)
          }
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
