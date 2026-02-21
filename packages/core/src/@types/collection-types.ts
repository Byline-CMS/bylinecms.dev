/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field } from './field-types.js'

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * The three status names that every workflow must contain.
 *
 * Storage, versioning, and API logic depend on these statuses being present.
 * `defineWorkflow()` enforces their existence and ordering automatically:
 *
 *   `[draft, ...customStatuses, published, archived]`
 */
export const WORKFLOW_STATUS_DRAFT = 'draft' as const
export const WORKFLOW_STATUS_PUBLISHED = 'published' as const
export const WORKFLOW_STATUS_ARCHIVED = 'archived' as const
export const REQUIRED_WORKFLOW_STATUSES = [
  WORKFLOW_STATUS_DRAFT,
  WORKFLOW_STATUS_PUBLISHED,
  WORKFLOW_STATUS_ARCHIVED,
] as const
export type RequiredWorkflowStatusName = (typeof REQUIRED_WORKFLOW_STATUSES)[number]

/**
 * A single status in a sequential workflow.
 *
 * `name` is the value stored in the database (e.g. `'draft'`, `'needs_review'`).
 * `label` is an optional human-readable display label for the status indicator (defaults to `name`).
 * `verb` is an optional action label shown on the transition button (e.g. "Publish"). Defaults to `label` then `name`.
 */
export interface WorkflowStatus {
  name: string
  label?: string
  verb?: string
}

/**
 * Configurable sequential workflow for a collection.
 *
 * The `statuses` array defines the ordered progression. The first entry is
 * used as the default status for new documents unless `defaultStatus` is
 * explicitly set.
 *
 * @example
 * ```ts
 * defineWorkflow({
 *   draft:     { label: 'Draft',     verb: 'Revert to Draft' },
 *   published: { label: 'Published', verb: 'Publish' },
 *   archived:  { label: 'Archived',  verb: 'Archive' },
 *   customStatuses: [
 *     { name: 'needs_review', label: 'Needs Review', verb: 'Request Review' },
 *   ],
 * })
 * ```
 */
export interface WorkflowConfig {
  statuses: WorkflowStatus[]
  /** Override the default status for new documents (defaults to the first entry). */
  defaultStatus?: string
}

/**
 * Optional label/verb overrides for one of the three required workflow statuses.
 *
 * The `name` is fixed (`'draft'`, `'published'`, or `'archived'`) and injected
 * automatically by `defineWorkflow()`.
 */
export interface RequiredStatusConfig {
  label?: string
  verb?: string
}

/**
 * Input accepted by `defineWorkflow()`.
 *
 * The three required statuses — `draft`, `published`, `archived` — are always
 * present in the resulting workflow. Their position is enforced:
 *
 *   `[draft, ...customStatuses, published, archived]`
 *
 * Each required status accepts an optional `{ label, verb }` override.
 * Any additional statuses are placed between `draft` and `published` via
 * `customStatuses`, in the order specified.
 */
export interface DefineWorkflowInput {
  /** Customize the `draft` status (always first). Defaults to `{ label: 'Draft' }`. */
  draft?: RequiredStatusConfig
  /** Customize the `published` status (always second-to-last). Defaults to `{ label: 'Published' }`. */
  published?: RequiredStatusConfig
  /** Customize the `archived` status (always last). Defaults to `{ label: 'Archived' }`. */
  archived?: RequiredStatusConfig
  /** Additional statuses placed between `draft` and `published`, in order. */
  customStatuses?: WorkflowStatus[]
  /** Override the default status for new documents (defaults to `'draft'`). */
  defaultStatus?: string
}

/**
 * The built-in default workflow used when a collection does not define its own.
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  statuses: [
    { name: 'draft', label: 'Draft' },
    { name: 'published', label: 'Published' },
    { name: 'archived', label: 'Archived' },
  ],
}

/**
 * Type-safe factory for creating a `WorkflowConfig`.
 *
 * Guarantees that the three required statuses (`draft`, `published`, `archived`)
 * are always present and correctly ordered:
 *
 *   `[draft, ...customStatuses, published, archived]`
 *
 * Custom statuses are inserted between `draft` and `published`. If a custom
 * status uses a reserved name (`draft`, `published`, or `archived`) this
 * function throws at initialization time.
 *
 * @example
 * ```ts
 * // Minimal — uses default labels for all three required statuses:
 * defineWorkflow({})
 *
 * // With custom labels/verbs on the required statuses:
 * defineWorkflow({
 *   draft:     { label: 'Draft',     verb: 'Revert to Draft' },
 *   published: { label: 'Published', verb: 'Publish' },
 *   archived:  { label: 'Archived',  verb: 'Archive' },
 * })
 *
 * // With additional statuses between draft and published:
 * defineWorkflow({
 *   draft:     { label: 'Draft',     verb: 'Revert to Draft' },
 *   published: { label: 'Published', verb: 'Publish' },
 *   archived:  { label: 'Archived',  verb: 'Archive' },
 *   customStatuses: [
 *     { name: 'needs_review', label: 'Needs Review', verb: 'Request Review' },
 *   ],
 * })
 * ```
 */
export function defineWorkflow(input: DefineWorkflowInput = {}): WorkflowConfig {
  const reserved = new Set<string>(REQUIRED_WORKFLOW_STATUSES)

  // Validate that no custom status uses a reserved name.
  if (input.customStatuses) {
    for (const s of input.customStatuses) {
      if (reserved.has(s.name)) {
        throw new Error(
          `defineWorkflow: custom status '${s.name}' conflicts with a required status name. ` +
            `Use the top-level '${s.name}' property to customize its label/verb instead.`
        )
      }
    }
  }

  const draft: WorkflowStatus = {
    name: WORKFLOW_STATUS_DRAFT,
    label: 'Draft',
    ...input.draft,
  }
  const published: WorkflowStatus = {
    name: WORKFLOW_STATUS_PUBLISHED,
    label: 'Published',
    ...input.published,
  }
  const archived: WorkflowStatus = {
    name: WORKFLOW_STATUS_ARCHIVED,
    label: 'Archived',
    ...input.archived,
  }

  const statuses: WorkflowStatus[] = [draft, ...(input.customStatuses ?? []), published, archived]

  return {
    statuses,
    ...(input.defaultStatus ? { defaultStatus: input.defaultStatus } : {}),
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

// -- Hook context types -----------------------------------------------------

/**
 * Context passed to `beforeCreate` hooks.
 *
 * The hook can mutate `data` before it is persisted.
 */
export interface BeforeCreateContext {
  data: Record<string, any>
  collectionPath: string
}

/**
 * Context passed to `afterCreate` hooks.
 *
 * Includes the `documentId` and `documentVersionId` returned by storage
 * so the hook can reference the persisted document.
 */
export interface AfterCreateContext {
  data: Record<string, any>
  collectionPath: string
  documentId: string
  documentVersionId: string
}

/**
 * Context passed to `beforeUpdate` hooks — both PUT and patch flows.
 *
 * `data` is the next version (mutable). `originalData` is the previous
 * version as reconstructed from storage.
 */
export interface BeforeUpdateContext {
  data: Record<string, any>
  originalData: Record<string, any>
  collectionPath: string
}

/**
 * Context passed to `afterUpdate` hooks.
 *
 * Includes the `documentId` and `documentVersionId` of the newly created
 * version so the hook can reference the persisted document.
 */
export interface AfterUpdateContext {
  data: Record<string, any>
  originalData: Record<string, any>
  collectionPath: string
  documentId: string
  documentVersionId: string
}

/**
 * Context passed to `beforeStatusChange` / `afterStatusChange` hooks.
 */
export interface StatusChangeContext {
  documentId: string
  documentVersionId: string
  collectionPath: string
  previousStatus: string
  nextStatus: string
}

/**
 * Context passed to `beforeUnpublish` hooks.
 */
export interface BeforeUnpublishContext {
  documentId: string
  collectionPath: string
}

/**
 * Context passed to `afterUnpublish` hooks.
 *
 * `archivedCount` indicates how many published versions were archived.
 */
export interface AfterUnpublishContext {
  documentId: string
  collectionPath: string
  archivedCount: number
}

/**
 * Context passed to `beforeDelete` / `afterDelete` hooks (future).
 */
export interface DeleteContext {
  id: string
  collectionPath: string
}

// -- CollectionHooks interface ----------------------------------------------

/**
 * Lifecycle hooks for a collection.
 *
 * Each hook receives a typed context object. `before*` hooks can mutate the
 * data before it is persisted; `after*` hooks receive the final data after
 * persistence together with identifiers of what was created/updated.
 *
 * Hooks run **outside** the storage transaction — they cannot participate in
 * the atomic write. They are suitable for logging, cache invalidation,
 * webhooks, and similar side-effects.
 *
 * Hooks are optional — if omitted, the framework skips the step.
 */
export interface CollectionHooks {
  // -- Document create ------------------------------------------------------
  /** Runs before a new document is created. Can mutate `data`. */
  beforeCreate?: (ctx: BeforeCreateContext) => void | Promise<void>
  /** Runs after a new document is created. */
  afterCreate?: (ctx: AfterCreateContext) => void | Promise<void>

  // -- Document update (PUT or patches) -------------------------------------
  /** Runs before an existing document is updated (PUT or patch). Can mutate `data`. */
  beforeUpdate?: (ctx: BeforeUpdateContext) => void | Promise<void>
  /** Runs after an existing document is updated. */
  afterUpdate?: (ctx: AfterUpdateContext) => void | Promise<void>

  // -- Workflow status change -----------------------------------------------
  /** Runs before a document's workflow status is changed. */
  beforeStatusChange?: (ctx: StatusChangeContext) => void | Promise<void>
  /** Runs after a document's workflow status has been changed. */
  afterStatusChange?: (ctx: StatusChangeContext) => void | Promise<void>

  // -- Unpublish (cross-version archive) ------------------------------------
  /** Runs before a published document is unpublished (archived). */
  beforeUnpublish?: (ctx: BeforeUnpublishContext) => void | Promise<void>
  /** Runs after a published document has been unpublished.  */
  afterUnpublish?: (ctx: AfterUnpublishContext) => void | Promise<void>

  // -- Document delete (future) ---------------------------------------------
  /** Runs before a document is deleted. */
  beforeDelete?: (ctx: DeleteContext) => void | Promise<void>
  /** Runs after a document is deleted. */
  afterDelete?: (ctx: DeleteContext) => void | Promise<void>
}

export interface CollectionDefinition {
  labels: {
    singular: string
    plural: string
  }
  path: string
  fields: Field[]
  /** Sequential workflow configuration. Falls back to DEFAULT_WORKFLOW if omitted. */
  workflow?: WorkflowConfig
  /** Lifecycle hooks for server-side document operations. */
  hooks?: CollectionHooks
}

/**
 * Type-safe factory for creating a CollectionDefinition.
 * Returns the definition as-is but provides type checking.
 */
export function defineCollection(definition: CollectionDefinition): CollectionDefinition {
  return definition
}
