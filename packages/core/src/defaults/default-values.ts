import { isStructureField } from '../@types/field-types.js'
import type { DefaultValue, DefaultValueContext, FieldSet } from '../@types/field-types.js'

function normalizeCtx(ctx?: Partial<DefaultValueContext>): DefaultValueContext {
  return {
    data: ctx?.data ?? {},
    locale: ctx?.locale,
    now: ctx?.now ?? (() => new Date()),
    uuid: ctx?.uuid,
  }
}

export async function resolveDefaultValue<T>(
  defaultValue: DefaultValue<T> | undefined,
  ctx?: Partial<DefaultValueContext>
): Promise<T | undefined> {
  if (defaultValue === undefined) {
    return undefined
  }

  const normalized = normalizeCtx(ctx)

  if (typeof defaultValue === 'function') {
    return (defaultValue as (c: DefaultValueContext) => T | Promise<T>)(normalized)
  }

  return defaultValue
}

export async function resolveFieldDefaultValue(
  field: { defaultValue?: DefaultValue } & Record<string, any>,
  ctx?: Partial<DefaultValueContext>
): Promise<unknown | undefined> {
  return resolveDefaultValue(field.defaultValue, ctx)
}

/**
 * Build initial document data from a field list.
 *
 * This is intentionally conservative: it only sets values that are explicitly defaulted
 * (either via `defaultValue` or via nested structure fields that have child defaults).
 */
export async function buildInitialDataFromFields(
  fields: FieldSet,
  ctx?: Partial<DefaultValueContext>
): Promise<Record<string, any>> {
  const normalized = normalizeCtx(ctx)
  const out: Record<string, any> = {}

  for (const field of fields) {
    const currentData = { ...normalized.data, ...out }

    const explicit = await resolveFieldDefaultValue(field, {
      ...normalized,
      data: currentData,
    })

    if (explicit !== undefined) {
      out[field.name] = explicit
      continue
    }

    if (!isStructureField(field)) {
      continue
    }

    // If this is a structure field with child defaults, build a nested default.
    // For arrays we avoid guessing a default shape.
    if (field.type === 'group') {
      // Group fields are represented as a plain object keyed by child field names.
      const nested = await buildInitialDataFromFields(field.fields, {
        ...normalized,
        data: currentData,
      })
      if (Object.keys(nested).length > 0) {
        out[field.name] = nested
      }
    }
  }

  return out
}
