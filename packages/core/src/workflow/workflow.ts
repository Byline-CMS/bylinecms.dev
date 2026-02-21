/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { DEFAULT_WORKFLOW } from '../@types/collection-types.js'
import type {
  CollectionDefinition,
  WorkflowConfig,
  WorkflowStatus,
} from '../@types/collection-types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective workflow for a collection.
 * Falls back to `DEFAULT_WORKFLOW` when the collection omits its own.
 */
export function getWorkflow(collection: CollectionDefinition): WorkflowConfig {
  return collection.workflow ?? DEFAULT_WORKFLOW
}

/**
 * Return the ordered status list for a collection.
 */
export function getWorkflowStatuses(collection: CollectionDefinition): WorkflowStatus[] {
  return getWorkflow(collection).statuses
}

/**
 * Return the default status name for new documents in a collection.
 */
export function getDefaultStatus(collection: CollectionDefinition): string {
  const workflow = getWorkflow(collection)
  return workflow.defaultStatus ?? workflow.statuses[0]?.name ?? 'draft'
}

// ---------------------------------------------------------------------------
// Transition validation
// ---------------------------------------------------------------------------

export interface TransitionResult {
  valid: boolean
  reason?: string
}

/**
 * Validate a status transition within a sequential workflow.
 *
 * Allowed moves:
 * - Forward one step  (e.g. draft → needs_review)
 * - Backward one step (e.g. needs_review → draft)
 * - Reset to first status from any position (e.g. published → draft)
 * - Same status (no-op, always valid)
 */
export function validateStatusTransition(
  workflow: WorkflowConfig,
  currentStatus: string,
  nextStatus: string
): TransitionResult {
  if (currentStatus === nextStatus) {
    return { valid: true }
  }

  const statuses = workflow.statuses
  const currentIndex = statuses.findIndex((s) => s.name === currentStatus)
  const nextIndex = statuses.findIndex((s) => s.name === nextStatus)

  if (currentIndex === -1) {
    return {
      valid: false,
      reason: `Current status '${currentStatus}' is not defined in the workflow.`,
    }
  }
  if (nextIndex === -1) {
    return { valid: false, reason: `Target status '${nextStatus}' is not defined in the workflow.` }
  }

  // Reset to first status is always allowed.
  if (nextIndex === 0) {
    return { valid: true }
  }

  const diff = nextIndex - currentIndex
  if (diff === 1 || diff === -1) {
    return { valid: true }
  }

  return {
    valid: false,
    reason: `Cannot transition from '${currentStatus}' to '${nextStatus}'. Only sequential (±1 step) or reset-to-first transitions are allowed.`,
  }
}

/**
 * Return the status names that are valid targets from the given current status.
 */
export function getAvailableTransitions(workflow: WorkflowConfig, currentStatus: string): string[] {
  const statuses = workflow.statuses
  const currentIndex = statuses.findIndex((s) => s.name === currentStatus)

  if (currentIndex === -1) return []

  const targets: string[] = []

  // Reset to first (unless already there).
  const first = statuses[0]
  if (currentIndex !== 0 && first) {
    targets.push(first.name)
  }

  // Backward one step (if not at start and different from first).
  const prev = statuses[currentIndex - 1]
  if (currentIndex > 1 && prev) {
    targets.push(prev.name)
  }

  // Forward one step.
  const next = statuses[currentIndex + 1]
  if (currentIndex < statuses.length - 1 && next) {
    targets.push(next.name)
  }

  return targets
}
