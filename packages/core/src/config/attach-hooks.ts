import { formatDeclarationPath, walkFieldDeclarations } from '../paths/index.js'
import type {
  CollectionDefinition,
  CollectionHooks,
  CollectionHooksLoader,
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
    assertPathSafeSegment(collection.path, `collection path "${collection.path}"`)
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

  walkFieldDeclarations(
    collection.fields,
    (field, segments) => {
      assertPathSafeSegment(
        field.name,
        `field name "${field.name}" in collection "${collection.path}"`
      )
      if ((field.type !== 'file' && field.type !== 'image') || field.upload === undefined) return

      const canonical = `${collection.path}.${formatDeclarationPath(segments)}`
      const previous = leafPaths.get(field.name)
      if (previous !== undefined) {
        throw new Error(
          `Collection "${collection.path}" has duplicate upload-capable leaf name "${field.name}" at "${previous}" and "${canonical}". Upload leaf names must be unique within a collection.`
        )
      }
      leafPaths.set(field.name, canonical)
      uploadFields.set(canonical, field)
    },
    {
      // Every block is checked, including one declaring no fields — such a
      // block never reaches the field visitor, so inferring block types from
      // field segments alone would silently stop validating them.
      onBlock: (block) => {
        assertPathSafeSegment(
          block.blockType,
          `block type "${block.blockType}" in collection "${collection.path}"`
        )
      },
    }
  )
}

/**
 * A name that appears as a path segment must not contain the grammar's own
 * punctuation.
 *
 * `.` separates segments in every notation. `[` and `]` delimit item selectors
 * in instance paths, which field names already reach — a field named `a[0]`
 * would not survive the round trip through `parseInstancePath`. Both are
 * rejected where the name is declared rather than left to corrupt a path
 * later.
 */
function assertPathSafeSegment(segment: string, label: string): void {
  if (segment.length === 0) {
    throw new Error(`${label} must be a non-empty path segment.`)
  }
  for (const character of ['.', '[', ']']) {
    if (segment.includes(character)) {
      throw new Error(
        `${label} must not contain "${character}" — it is field path grammar punctuation.`
      )
    }
  }
}
