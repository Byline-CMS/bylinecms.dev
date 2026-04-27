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
// When strict=true (write operations: create/update), field.optional is
// respected (required fields are actually required).
// When strict=false (read operations: list/get/history), all fields are
// nullable+optional regardless — this means adding a required field to an
// existing collection never breaks reads of older documents that were
// stored before the field existed.
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
          fileId: z.string(),
          filename: z.string(),
          originalFilename: z.string(),
          mimeType: z.string(),
          fileSize: z.string(),
          storageProvider: z.string(),
          storagePath: z.string(),
          storageUrl: z.string().nullable().optional(),
          fileHash: z.string().nullable().optional(),
          imageWidth: z.number().nullable().optional(),
          imageHeight: z.number().nullable().optional(),
          imageFormat: z.string().nullable().optional(),
          processingStatus: z.enum(['pending', 'processing', 'complete', 'failed']),
          thumbnailGenerated: z.boolean().optional(),
        })
        .passthrough()
      break
    }

    case 'blocks':
      schema = z.any().array()
      break

    case 'group':
      // Group fields are complex nested structures validated at the
      // field-renderer level. The shape depends on the group's child fields
      // (recursive) and is not constrained here.
      schema = z.any()
      break

    case 'relation':
      // Relation values are `RelatedDocumentValue` objects:
      //   { targetDocumentId, targetCollectionId,
      //     relationshipType?, cascadeDelete? }
      // Values come from the picker (UUIDs) or from DB reads (also UUIDs),
      // but tests may use shorter strings — keep the schema shape-strict
      // without enforcing UUID format so synthetic fixtures still validate.
      //
      // Populated responses (depth > 0) skip this schema in the route layer
      // because the tree then contains nested documents, not bare refs.
      schema = z
        .object({
          targetDocumentId: z.string(),
          targetCollectionId: z.string(),
          relationshipType: z.string().optional(),
          cascadeDelete: z.boolean().optional(),
        })
        .nullable()
      break

    default:
      schema = z.string()
  }

  // In strict mode respect field.optional; in lenient mode always allow null/undefined so reads
  // never fail on schema-evolved documents.
  return strict && !field.optional ? schema : schema.nullable().optional()
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
    id: z.uuid(),
    versionId: z.uuid().optional(),
    path: z.string().optional(),
    status: statusEnum,
    hasPublishedVersion: z.boolean().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
}

// Create field schemas for a collection.
// strict=true  → required fields are non-nullable (write / validation use)
// strict=false → all fields are nullable+optional (read / serialisation use)
export const createFieldsSchema = (fields: Field[], strict = true) => {
  // Use ZodType<any> so the inferred object output is { [x: string]: any }
  // rather than { [x: string]: unknown } (Zod v4 defaults ZodType to <unknown>).
  // This keeps the schema assignable through TanStack Start's serialisation boundary.
  const fieldsSchemaShape: Record<string, z.ZodType<any>> = {}

  for (const field of fields) {
    fieldsSchemaShape[field.name] = fieldToZodSchema(field, strict)
  }

  return z.object(fieldsSchemaShape)
}

// Create pagination/list metadata schema
export const createListMetaSchema = () =>
  z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    order: z.string().optional(),
    desc: z.boolean().optional(),
  })

// Create collection metadata schema
export const createCollectionMetaSchema = (collection: CollectionDefinition) =>
  z.object({
    id: z.string(),
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
    fields: fieldsSchema,
  })

  const fullSchemaLenient = z.object({
    ...baseSchema.shape,
    fields: fieldsSchemaLenient,
  })

  return {
    base: baseSchema,
    fields: fieldsSchema,
    full: fullSchema,
    list: z.object({
      docs: z.array(fullSchemaLenient),
      meta: createListMetaSchema(),
      included: z.object({
        collection: createCollectionMetaSchema(collection),
      }),
    }),
    history: z.object({
      docs: z.array(fullSchemaLenient),
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
