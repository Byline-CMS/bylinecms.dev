import type {
  CollectionDefinition,
  CollectionHooks,
  CollectionHooksLoader,
  Field,
  FileField,
  ImageField,
  ServerHooksConfig,
  UploadHooks,
  UploadHooksLoader,
} from '../@types/index.js'

type CollectionHookValue = CollectionHooks | CollectionHooksLoader
type UploadHookValue = UploadHooks | UploadHooksLoader
type UploadField = ImageField | FileField

export type HookAttachmentOperation =
  | {
      kind: 'collection'
      target: CollectionDefinition
      hooks: CollectionHookValue | undefined
    }
  | {
      kind: 'upload'
      target: UploadField
      hooks: UploadHookValue | undefined
    }

const registryCollectionHooks = new WeakMap<CollectionDefinition, CollectionHookValue>()
const registryUploadHooks = new WeakMap<UploadField, UploadHookValue>()

/**
 * Validate a server hook registry and prepare its in-place definition updates.
 * This phase never mutates definitions, so callers may safely abandon the plan
 * when later initialization work fails.
 */
export function prepareHookAttachment(config: {
  collections: readonly CollectionDefinition[]
  hooks?: ServerHooksConfig
}): HookAttachmentOperation[] {
  const collections = new Map<string, CollectionDefinition>()
  const uploadFields = new Map<string, UploadField>()

  for (const collection of config.collections) {
    assertDotFreeSegment(collection.path, `collection path "${collection.path}"`)
    collections.set(collection.path, collection)
    indexUploadFields(collection, uploadFields)
  }

  const requestedCollections = new Map(Object.entries(config.hooks?.collections ?? {}))
  const requestedUploads = new Map(Object.entries(config.hooks?.uploads ?? {}))

  for (const path of requestedCollections.keys()) {
    if (!collections.has(path)) {
      throw new Error(`ServerConfig.hooks.collections references unknown collection "${path}".`)
    }
  }
  for (const path of requestedUploads.keys()) {
    if (!uploadFields.has(path)) {
      throw new Error(
        `ServerConfig.hooks.uploads references unknown or non-upload field "${path}".`
      )
    }
  }

  const operations: HookAttachmentOperation[] = []
  for (const collection of config.collections) {
    const requested = requestedCollections.get(collection.path)
    planCollectionAttachment(collection, requested, operations)
  }
  for (const [path, field] of uploadFields) {
    const requested = requestedUploads.get(path)
    planUploadAttachment(path, field, requested, operations)
  }
  return operations
}

/** Commit a previously validated attachment plan synchronously. */
export function commitHookAttachment(operations: readonly HookAttachmentOperation[]): void {
  for (const operation of operations) {
    if (operation.kind === 'collection') {
      operation.target.hooks = operation.hooks
      if (operation.hooks === undefined) registryCollectionHooks.delete(operation.target)
      else registryCollectionHooks.set(operation.target, operation.hooks)
      continue
    }

    // Upload operations are prepared only for upload-capable fields.
    const upload = operation.target.upload
    if (!upload) continue
    upload.hooks = operation.hooks
    if (operation.hooks === undefined) registryUploadHooks.delete(operation.target)
    else registryUploadHooks.set(operation.target, operation.hooks)
  }
}

function planCollectionAttachment(
  collection: CollectionDefinition,
  requested: CollectionHookValue | undefined,
  operations: HookAttachmentOperation[]
): void {
  const owned = registryCollectionHooks.get(collection)
  assertOwnershipIntact(`collection "${collection.path}"`, collection.hooks, owned)
  if (requested === undefined) {
    if (owned !== undefined) {
      operations.push({ kind: 'collection', target: collection, hooks: undefined })
    }
    return
  }
  if (owned === undefined && collection.hooks !== undefined) {
    throw new Error(
      `ServerConfig.hooks.collections cannot replace definition-authored hooks on collection "${collection.path}".`
    )
  }
  if (requested !== collection.hooks) {
    operations.push({ kind: 'collection', target: collection, hooks: requested })
  }
}

function planUploadAttachment(
  path: string,
  field: UploadField,
  requested: UploadHookValue | undefined,
  operations: HookAttachmentOperation[]
): void {
  const owned = registryUploadHooks.get(field)
  assertOwnershipIntact(`upload field "${path}"`, field.upload?.hooks, owned)
  if (requested === undefined) {
    if (owned !== undefined) {
      operations.push({ kind: 'upload', target: field, hooks: undefined })
    }
    return
  }
  if (owned === undefined && field.upload?.hooks !== undefined) {
    throw new Error(
      `ServerConfig.hooks.uploads cannot replace definition-authored hooks on upload field "${path}".`
    )
  }
  if (requested !== field.upload?.hooks) {
    operations.push({ kind: 'upload', target: field, hooks: requested })
  }
}

function assertOwnershipIntact<T>(
  label: string,
  current: T | undefined,
  owned: T | undefined
): void {
  if (owned !== undefined && current !== owned) {
    throw new Error(
      `Registry-owned hooks on ${label} changed outside ServerConfig.hooks; refusing to overwrite definition state.`
    )
  }
}

function indexUploadFields(
  collection: CollectionDefinition,
  uploadFields: Map<string, UploadField>
): void {
  const leafPaths = new Map<string, string>()

  const walk = (fields: readonly Field[], prefix: readonly string[]): void => {
    for (const field of fields) {
      assertDotFreeSegment(
        field.name,
        `field name "${field.name}" in collection "${collection.path}"`
      )
      const path = [...prefix, field.name]
      if ((field.type === 'file' || field.type === 'image') && field.upload !== undefined) {
        const canonical = [collection.path, ...path].join('.')
        const previous = leafPaths.get(field.name)
        if (previous !== undefined) {
          throw new Error(
            `Collection "${collection.path}" has duplicate upload-capable leaf name "${field.name}" at "${previous}" and "${canonical}". Upload leaf names must be unique within a collection.`
          )
        }
        leafPaths.set(field.name, canonical)
        uploadFields.set(canonical, field)
      }
      if (field.type === 'group' || field.type === 'array') {
        walk(field.fields, path)
      } else if (field.type === 'blocks') {
        for (const block of field.blocks) {
          assertDotFreeSegment(
            block.blockType,
            `block type "${block.blockType}" in collection "${collection.path}"`
          )
          walk(block.fields, [...path, block.blockType])
        }
      }
    }
  }

  walk(collection.fields, [])
}

function assertDotFreeSegment(segment: string, label: string): void {
  if (segment.length === 0 || segment.includes('.')) {
    throw new Error(`${label} must be a non-empty, dot-free hook registry path segment.`)
  }
}
