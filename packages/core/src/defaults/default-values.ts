import { isStructureField } from '../@types/field-types.js'
import type {
  DefaultValue,
  DefaultValueContext,
  Field,
  StructureField,
} from '../@types/field-types.js'

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
  field: { defaultValue?: DefaultValue },
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
  fields: Field[],
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
    if (field.type === 'composite') {
      // Composites are represented in the dashboard as an array of single-key objects.
      const nested = await buildInitialDataFromFields(field.fields, {
        ...normalized,
        data: currentData,
      })
      if (Object.keys(nested).length > 0) {
        out[field.name] = field.fields.map((child) => ({ [child.name]: nested[child.name] }))
      }
    }
  }

  return out
}
