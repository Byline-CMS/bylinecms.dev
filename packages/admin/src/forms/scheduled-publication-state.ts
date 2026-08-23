/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Presentation state for a document's pending publication schedule.
 *
 * The editor surfaces four situations, and they differ in how loudly they
 * should be presented, not just in wording:
 *
 *   - `none`            — nothing scheduled; only the "schedule" action applies.
 *   - `armed`           — a future instant is authorized against a reviewed
 *                         version. Quiet: a metadata cell in the status bar.
 *   - `needs_reconfirm` — content was saved after the time was authorized, so
 *                         the schedule is suspended until an editor reviews and
 *                         confirms the current version. Loud, and durable: this
 *                         has to stay discoverable long after the toast is gone.
 *   - `overdue`         — armed, due, and not yet finalized. The sweep may still
 *                         be retrying, and `lastError` may carry a bounded
 *                         reason. Loud.
 *
 * Deriving this in one pure place keeps the branching out of the components and
 * makes the awkward combinations (a suspended schedule whose instant has also
 * passed; an overdue schedule the actor may not cancel) testable without a DOM.
 */

export type ScheduledPublicationStateKind = 'none' | 'armed' | 'needs_reconfirm' | 'overdue'

/** How prominently the state should be rendered. */
export type ScheduledPublicationTone = 'neutral' | 'info' | 'warning' | 'danger'

export interface ScheduledPublicationInfo {
  publishAt: string | Date
  targetVersionId: string
  state: 'armed' | 'needs_reconfirm'
  lastAuthorizedBy: string | null
  lastError: string | null
  nextAttemptAt: string | Date
  attemptCount: number
}

/**
 * Which operations the host has wired up for this document and actor. A
 * missing handler means the actor cannot perform the operation — the server
 * decides, and the editor never renders an action it cannot complete.
 */
export interface ScheduledPublicationCapabilities {
  canSchedule: boolean
  canConfirm: boolean
  canCancel: boolean
}

export interface ScheduledPublicationState {
  kind: ScheduledPublicationStateKind
  tone: ScheduledPublicationTone
  /** The authorized instant, or null when nothing is scheduled. */
  publishAt: Date | null
  /**
   * True when the authorized instant has passed. Tracked separately from
   * `kind` so a suspended schedule that is also past due still reads as
   * "needs re-confirmation" — the reason it did not publish — while the
   * elapsed time remains available to the summary.
   */
  isPastDue: boolean
  /** Bounded failure reason from the last sweep attempt, when the server sent one. */
  lastError: string | null
  /** Sweep attempts so far. Only meaningful once the instant has passed. */
  attemptCount: number
  /** True when the state warrants an escalated, dismissible-proof notice rather than a metadata cell. */
  isExceptional: boolean
  actions: {
    schedule: boolean
    reschedule: boolean
    confirm: boolean
    cancel: boolean
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Derive the editor's presentation state from the server's schedule record.
 *
 * `now` is injected rather than read from the clock so the boundary between
 * armed and overdue is testable, and so a single render pass cannot disagree
 * with itself.
 */
export function deriveScheduledPublicationState(
  schedule: ScheduledPublicationInfo | null,
  capabilities: ScheduledPublicationCapabilities,
  now: number
): ScheduledPublicationState {
  if (schedule == null) {
    return {
      kind: 'none',
      tone: 'neutral',
      publishAt: null,
      isPastDue: false,
      lastError: null,
      attemptCount: 0,
      isExceptional: false,
      actions: {
        schedule: capabilities.canSchedule,
        reschedule: false,
        confirm: false,
        cancel: false,
      },
    }
  }

  const publishAt = toDate(schedule.publishAt)
  const isPastDue = Number.isFinite(publishAt.getTime()) && publishAt.getTime() <= now
  const needsReconfirm = schedule.state === 'needs_reconfirm'
  const kind: ScheduledPublicationStateKind = needsReconfirm
    ? 'needs_reconfirm'
    : isPastDue
      ? 'overdue'
      : 'armed'

  // An error the sweep reported outranks the state's own tone: it is the only
  // signal that automatic publication is actively failing rather than pending.
  const tone: ScheduledPublicationTone =
    schedule.lastError != null ? 'danger' : kind === 'armed' ? 'info' : 'warning'

  return {
    kind,
    tone,
    publishAt,
    isPastDue,
    lastError: schedule.lastError,
    attemptCount: schedule.attemptCount,
    isExceptional: kind !== 'armed',
    actions: {
      schedule: false,
      reschedule: capabilities.canSchedule,
      confirm: needsReconfirm && capabilities.canConfirm,
      cancel: capabilities.canCancel,
    },
  }
}
