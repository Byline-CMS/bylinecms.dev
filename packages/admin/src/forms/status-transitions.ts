/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { WorkflowStatus } from '@byline/core'

export interface StatusTransitions {
  primaryStatus: WorkflowStatus | undefined
  secondaryStatuses: WorkflowStatus[]
  isTerminal: boolean
}

/**
 * Compute the primary and secondary status transitions for the ComboButton.
 * - Primary: the main action (forward step), or the current status itself
 *   when the document has reached the final workflow step (terminal state).
 * - Secondary: other available transitions to show as dropdown options.
 * - isTerminal: true when the document is at the final workflow status —
 *   the primary button renders as a non-actionable indicator and all
 *   back-steps move into the dropdown.
 */
export function computeStatusTransitions(
  currentStatus: string | undefined,
  workflowStatuses: WorkflowStatus[] | undefined,
  nextStatus: WorkflowStatus | undefined
): StatusTransitions {
  if (!workflowStatuses || workflowStatuses.length === 0 || !currentStatus) {
    return { primaryStatus: nextStatus, secondaryStatuses: [], isTerminal: false }
  }

  // Single-status workflows (e.g. SINGLE_STATUS_WORKFLOW for lookups) have
  // no transitions — short-circuit so the form shows only Close / Save.
  if (workflowStatuses.length <= 1) {
    return { primaryStatus: undefined, secondaryStatuses: [], isTerminal: false }
  }

  const currentIndex = workflowStatuses.findIndex((s) => s.name === currentStatus)
  if (currentIndex === -1) {
    return { primaryStatus: nextStatus, secondaryStatuses: [], isTerminal: false }
  }

  const isAtEnd = currentIndex === workflowStatuses.length - 1
  const isAtStart = currentIndex === 0

  // Collect all available target statuses
  const availableTargets: WorkflowStatus[] = []

  // Reset to first (if not at first)
  if (!isAtStart && workflowStatuses[0]) {
    availableTargets.push(workflowStatuses[0])
  }

  // Back one step (if not at start and the previous is not already the first)
  const prev = workflowStatuses[currentIndex - 1]
  if (currentIndex > 1 && prev) {
    availableTargets.push(prev)
  }

  // Forward one step (if not at end) - this is the nextStatus
  const next = workflowStatuses[currentIndex + 1]
  if (!isAtEnd && next) {
    availableTargets.push(next)
  }

  if (isAtEnd) {
    // Terminal state: the primary button is a non-actionable indicator of the
    // current status; both back-steps (revert to previous / reset to first)
    // are surfaced in the dropdown.
    return {
      primaryStatus: workflowStatuses[currentIndex],
      secondaryStatuses: availableTargets,
      isTerminal: true,
    }
  }

  // Not at end: primary is the forward step (nextStatus)
  return {
    primaryStatus: nextStatus,
    secondaryStatuses: availableTargets.filter((s) => s.name !== nextStatus?.name),
    isTerminal: false,
  }
}
