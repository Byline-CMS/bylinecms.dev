import * as z from 'zod'

import { REQUIRED_WORKFLOW_STATUSES } from '../../@types/index.js'
import { getCollectionDefinition } from '../../config/config.js'
import type {
  CollectionDefinition,
  DateTimeField,
  Field,
  TextField,
  ValidationRule,
} from '../../@types/index.js'

// Helper function to apply custom validation rules
const applyValidationRules = (schema: z.ZodType, rules: ValidationRule[]): z.ZodType => {
  return rules.reduce((acc, rule) => {
    switch (rule.type) {
      case 'email':
        return (acc as z.ZodEmail).describe(rule.message || 'Invalid email address')
      case 'url':
        return (acc as z.ZodURL).describe(rule.message || 'Invalid URL')
      case 'pattern':
        return (acc as z.ZodString).regex(new RegExp(rule.value), rule.message)
      case 'custom':
        return acc.refine(rule.value, { message: rule.message })
      default:
        return acc
    }
  }, schema)
}

// Helper function to apply text field validation
const applyTextValidation = (schema: z.ZodString, field: TextField): z.ZodString => {
  let validatedSchema = schema

  if (field.validation?.minLength) {
    validatedSchema = validatedSchema.min(field.validation.minLength)
  }

  if (field.validation?.maxLength) {
    validatedSchema = validatedSchema.max(field.validation.maxLength)
  }

  if (field.validation?.pattern) {
    validatedSchema = validatedSchema.regex(new RegExp(field.validation.pattern))
  }

  return validatedSchema
}

// Helper function to apply datetime validation
const _applyDateTimeValidation = (schema: z.ZodType, _field: DateTimeField): z.ZodType => {
  // TODO: Implement specific datetime validation if needed
  const validatedSchema = schema
  return validatedSchema
}

// Convert a single field to a Zod schema.
// When strict=true (write operations: create/update), field.required is
// enforced. When strict=false (read operations: list/get/history), all
// fields are nullable+optional regardless — this means adding a required
// field to an existing collection never breaks reads of older documents
// that were stored before the field existed.
export const fieldToZodSchema = (field: Field, strict = true): z.ZodType => {
  let schema: z.ZodType

  switch (field.type) {
    case 'array':
      schema = z.any().array()
      break

    case 'text': {
      let textSchema = z.string()
      textSchema = applyTextValidation(textSchema, field)

      if (field.validation?.rules) {
        textSchema = applyValidationRules(textSchema, field.validation.rules) as z.ZodString
      }

      schema = textSchema
      break
    }

    case 'boolean':
    case 'checkbox':
      schema = z.boolean()
      break

    case 'select':
      if (field.options && field.options.length > 0) {
        const values = field.options.map((opt) => opt.value) as [string, ...string[]]
        schema = z.enum(values)
      } else {
        schema = z.string()
      }
      break

    case 'datetime': {
      const dateSchema = z.preprocess(
        (val) => (val === '' || val == null ? null : val),
        z.coerce.date().refine((val) => val.toString() !== 'Invalid Date', {
          message: 'Invalid date',
        })
      )
      // TODO: Implement specific datetime validation if needed
      // dateSchema = applyDateTimeValidation(dateTimeSchema, field)
      schema = dateSchema
      break
    }

    case 'richText': {
      const richTextSchema = z.any()
      // TODO: Implement rich text validation if needed
      // if (field.validation?.minLength || field.validation?.maxLength) {
      //   // Convert to string for validation if needed
      //   richTextSchema = z.string()
      //   if (field.validation.minLength) {
      //     richTextSchema = (richTextSchema as z.ZodString).min(field.validation.minLength)
      //   }
      //   if (field.validation.maxLength) {
      //     richTextSchema = (richTextSchema as z.ZodString).max(field.validation.maxLength)
      //   }
      // }

      schema = richTextSchema
      break
    }

    case 'textArea': {
      let textAreaSchema = z.string()
      if (field.validation?.minLength) {
        textAreaSchema = textAreaSchema.min(field.validation.minLength)
      }
      if (field.validation?.maxLength) {
        textAreaSchema = textAreaSchema.max(field.validation.maxLength)
      }
      schema = textAreaSchema
      break
    }

    case 'integer':
      schema = z.number().int()
      break

    case 'float':
    case 'decimal':
      schema = z.number()
      break

    case 'image':
    case 'file': {
      // StoredFileValue — the object written by the upload endpoint and
      // stored in the typed store_* tables. Use .passthrough() so schema
      // evolution (new fields) doesn't break existing documents.
      schema = z
        .object({
          file_id: z.string(),
          filename: z.string(),
          original_filename: z.string(),
          mime_type: z.string(),
          file_size: z.string(),
          storage_provider: z.string(),
          storage_path: z.string(),
          storage_url: z.string().nullable(),
          file_hash: z.string().nullable(),
          image_width: z.number().nullable(),
          image_height: z.number().nullable(),
          image_format: z.string().nullable(),
          processing_status: z.enum(['pending', 'processing', 'complete', 'failed']),
          thumbnail_generated: z.boolean(),
        })
        .passthrough()
      break
    }

    case 'blocks':
      schema = z.any().array()
      break

    case 'group':
    case 'relation':
      // Group fields are complex nested structures validated at the field-renderer
      // level. Relations store a document ID string or array; use z.any()
      // so the schema does not constrain shape here.
      schema = z.any()
      break

    default:
      schema = z.string()
  }

  // In strict mode respect field.required; in lenient mode always allow
  // null/undefined so reads never fail on schema-evolved documents.
  return strict && field.required ? schema : schema.nullable().optional()
}

// Create the base schema that all collections share.
// When a collection defines a workflow, status is constrained to its status names;
// otherwise it falls back to the required statuses (draft, published, archived).

export const createBaseSchema = (collection?: CollectionDefinition) => {
  const statuses =
    collection?.workflow?.statuses?.map((s) => s.name) ??
    ([...REQUIRED_WORKFLOW_STATUSES] as string[])
  // z.enum requires a non-empty tuple [string, ...string[]]
  const statusEnum = z.enum([statuses[0], ...statuses.slice(1)] as [string, ...string[]])

  return z.object({
    document_version_id: z.uuid().optional(),
    document_id: z.uuid(),
    status: statusEnum,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
}

// Create field schemas for a collection.
// strict=true  → required fields are non-nullable (write / validation use)
// strict=false → all fields are nullable+optional (read / serialisation use)
export const createFieldsSchema = (fields: Field[], strict = true) => {
  const fieldsSchemaShape: Record<string, z.ZodType> = {}

  for (const field of fields) {
    fieldsSchemaShape[field.name] = fieldToZodSchema(field, strict)
  }

  return z.object(fieldsSchemaShape)
}

// Create pagination/list metadata schema
export const createListMetaSchema = () =>
  z.object({
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
    order: z.string().optional(),
    desc: z.boolean().optional(),
  })

// Create collection metadata schema
export const createCollectionMetaSchema = (collection: CollectionDefinition) =>
  z.object({
    labels: z.object({
      singular: z.string(),
      plural: z.string(),
    }),
    path: z.literal(collection.path),
  })

// Helper function to get collection definition before calling createCollectionSchemas
export const createCollectionSchemasForPath = (path: string) => {
  const collectionDefinition = getCollectionDefinition(path)
  if (collectionDefinition == null) {
    throw new Error(`Collection not found for path: ${path}`)
  }
  return createCollectionSchemas(collectionDefinition)
}

// Main function to create all schemas for a collection
export const createCollectionSchemas = (collection: CollectionDefinition) => {
  const baseSchema = createBaseSchema(collection)

  // Strict (write) — required fields are enforced.
  const fieldsSchema = createFieldsSchema(collection.fields, true)

  // Lenient (read) — all fields are nullable+optional so that older
  // documents missing a newly-added required field never cause a parse
  // error in list / get / history responses.
  const fieldsSchemaLenient = createFieldsSchema(collection.fields, false)

  const fullSchema = z.object({
    ...baseSchema.shape,
    ...fieldsSchema.shape,
  })

  const fullSchemaLenient = z.object({
    ...baseSchema.shape,
    ...fieldsSchemaLenient.shape,
  })

  return {
    base: baseSchema,
    fields: fieldsSchema,
    full: fullSchema,
    list: z.object({
      documents: z.array(fullSchemaLenient),
      meta: createListMetaSchema(),
      included: z.object({
        collection: createCollectionMetaSchema(collection),
      }),
    }),
    history: z.object({
      documents: z.array(fullSchemaLenient),
      meta: createListMetaSchema(),
    }),
    create: fieldsSchema,
    get: fullSchemaLenient,
    update: fieldsSchema.partial(),
  }
}

// Aliases for consistency
export const createTypedCollectionSchemas = createCollectionSchemas
export const createTypedCollectionSchemasForPath = createCollectionSchemasForPath
