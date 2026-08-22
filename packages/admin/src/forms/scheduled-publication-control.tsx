'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Scheduled publication in the document editor.
 *
 * The feature is split across three surfaces rather than one block, because
 * the states differ in how much of the editor's attention they deserve:
 *
 *   - The **actions** live in the document-actions menu, next to the other
 *     document-level operations, so the status bar's primary Save / Publish
 *     controls keep their weight.
 *   - An **armed** schedule renders as one more metadata cell in the status
 *     bar, alongside Status and Last modified. It is a fact about the
 *     document, presented at the scale of the other facts.
 *   - **Needs re-confirmation**, **overdue** and **failing** schedules
 *     escalate to a non-dismissible Alert below the status bar, carrying
 *     their own actions. The `needs_reconfirm` notice in particular has to
 *     outlive the toast that announced it, which is exactly what an Alert
 *     with `close={false}` does.
 *
 * `useScheduledPublication` owns the state and the modal so a single parent
 * can place the three surfaces independently.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import {
  Alert,
  Button,
  CloseIcon,
  DatePicker,
  IconButton,
  Label,
  Modal,
  Select,
} from '@byline/ui/react'
import cx from 'clsx'

import styles from './scheduled-publication-control.module.css'
import { deriveScheduledPublicationState } from './scheduled-publication-state.js'
import {
  joinWallTime,
  resolveScheduledPublicationWallTime,
  wallTimeInZone,
} from './scheduled-publication-time.js'
import type {
  ScheduledPublicationCapabilities,
  ScheduledPublicationState,
} from './scheduled-publication-state.js'
import type {
  ScheduledPublicationInstantChoice,
  ScheduledPublicationWallTime,
} from './scheduled-publication-time.js'

export type { ScheduledPublicationInfo } from './scheduled-publication-state.js'

import type { ScheduledPublicationInfo } from './scheduled-publication-state.js'

export interface SchedulePublicationInput {
  publishAt: string
}

/** How often the armed → overdue boundary is re-checked while the editor sits open. */
const DUE_POLL_INTERVAL_MS = 30_000

/** Default offset for a fresh schedule — far enough out to be reviewable. */
const DEFAULT_LEAD_MS = 15 * 60_000

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function seedScheduleInstant(schedule: ScheduledPublicationInfo | null): Date {
  if (schedule != null) return new Date(schedule.publishAt)
  const seed = new Date(Date.now() + DEFAULT_LEAD_MS)
  seed.setSeconds(0, 0)
  return seed
}

export interface UseScheduledPublicationArgs {
  schedule: ScheduledPublicationInfo | null
  onSchedule?: (input: SchedulePublicationInput) => Promise<void>
  onConfirm?: () => Promise<void>
  onCancel?: () => Promise<void>
  hasUnsavedChanges: boolean
  onUnsavedChanges: () => void
}

export interface UseScheduledPublicationReturn {
  state: ScheduledPublicationState
  timeZone: string
  busy: boolean
  /** True when any surface has something to render for this document. */
  isActive: boolean
  openSchedule: () => void
  confirm: () => Promise<void>
  cancel: () => Promise<void>
  /** The schedule / reschedule modal. Render once, anywhere in the form. */
  modal: React.ReactNode
}

export function useScheduledPublication({
  schedule,
  onSchedule,
  onConfirm,
  onCancel,
  hasUnsavedChanges,
  onUnsavedChanges,
}: UseScheduledPublicationArgs): UseScheduledPublicationReturn {
  const timeZone = useMemo(browserTimeZone, [])
  const [now, setNow] = useState(() => Date.now())
  const [showSchedule, setShowSchedule] = useState(false)
  const [busy, setBusy] = useState(false)

  // Only tick while something is actually scheduled — an editor with no
  // schedule has no boundary to cross, and a bare form should not re-render
  // on a timer.
  useEffect(() => {
    if (schedule == null) return
    const timer = setInterval(() => setNow(Date.now()), DUE_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [schedule])

  const capabilities: ScheduledPublicationCapabilities = useMemo(
    () => ({
      canSchedule: onSchedule != null,
      canConfirm: onConfirm != null,
      canCancel: onCancel != null,
    }),
    [onSchedule, onConfirm, onCancel]
  )

  const state = useMemo(
    () => deriveScheduledPublicationState(schedule, capabilities, now),
    [schedule, capabilities, now]
  )

  // Scheduling authorizes a specific reviewed version, so an unsaved edit has
  // to be resolved before any of these operations can name a version. Cancel
  // is exempt: withdrawing a schedule says nothing about content.
  const openSchedule = useCallback(() => {
    if (hasUnsavedChanges) {
      onUnsavedChanges()
      return
    }
    setShowSchedule(true)
  }, [hasUnsavedChanges, onUnsavedChanges])

  const confirm = useCallback(async () => {
    if (onConfirm == null) return
    if (hasUnsavedChanges) {
      onUnsavedChanges()
      return
    }
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }, [onConfirm, hasUnsavedChanges, onUnsavedChanges])

  const cancel = useCallback(async () => {
    if (onCancel == null) return
    setBusy(true)
    try {
      await onCancel()
    } finally {
      setBusy(false)
    }
  }, [onCancel])

  const modal = showSchedule ? (
    <ScheduleModal
      schedule={schedule}
      timeZone={timeZone}
      onSubmit={async (input) => {
        if (onSchedule == null) return
        setBusy(true)
        try {
          await onSchedule(input)
          setShowSchedule(false)
        } finally {
          setBusy(false)
        }
      }}
      onDismiss={() => setShowSchedule(false)}
      busy={busy}
    />
  ) : null

  return {
    state,
    timeZone,
    busy,
    isActive: state.kind !== 'none' || state.actions.schedule,
    openSchedule,
    confirm,
    cancel,
    modal,
  }
}

// ---------------------------------------------------------------------------
// Status-bar cell — the quiet, armed presentation
// ---------------------------------------------------------------------------

function useInstantFormatter(timeZone: string) {
  const { locale } = useTranslation('byline-admin')
  return useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }),
    [locale, timeZone]
  )
}

/**
 * One metadata cell for the form's status bar, matching the Status /
 * Last modified / Created cells in scale and structure. Renders only for an
 * armed schedule — every other state is carried by the notice instead, so the
 * two never say the same thing twice.
 */
export function ScheduledPublicationCell({
  state,
  timeZone,
}: {
  state: ScheduledPublicationState
  timeZone: string
}) {
  const { t } = useTranslation('byline-admin')
  const format = useInstantFormatter(timeZone)

  if (state.kind !== 'armed' || state.publishAt == null) return null

  return (
    <div
      className={cx('byline-form-status-cell', 'byline-scheduled-publication-cell', styles.cell)}
    >
      <span className={cx('byline-form-status-muted', styles['cell-label'])}>
        {t('scheduledPublication.status.cellLabel')}
      </span>
      <span className={cx('byline-scheduled-publication-cell-value', styles['cell-value'])}>
        <time dateTime={state.publishAt.toISOString()}>{format.format(state.publishAt)}</time>{' '}
        <span className={styles.zone}>({timeZone})</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notice — the escalated presentation for every exceptional state
// ---------------------------------------------------------------------------

/**
 * The durable notice for a suspended, overdue or failing schedule. Not
 * dismissible: `needs_reconfirm` has to stay on screen until an editor acts on
 * it, long after the toast that announced the suspension has gone.
 */
export function ScheduledPublicationNotice({
  state,
  timeZone,
  busy,
  onConfirm,
  onReschedule,
  onCancel,
}: {
  state: ScheduledPublicationState
  timeZone: string
  busy: boolean
  onConfirm: () => void
  onReschedule: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('byline-admin')
  const format = useInstantFormatter(timeZone)

  if (!state.isExceptional || state.publishAt == null) return null

  const instant = `${format.format(state.publishAt)} (${timeZone})`
  const title =
    state.kind === 'needs_reconfirm'
      ? t('scheduledPublication.status.needsReconfirm')
      : t('scheduledPublication.status.overdue')

  return (
    <Alert
      className={cx('byline-scheduled-publication-notice', styles.notice)}
      intent={state.tone === 'danger' ? 'danger' : 'warning'}
      icon={true}
      close={false}
      title={title}
    >
      <p className={styles['notice-body']}>
        {state.kind === 'needs_reconfirm'
          ? t('scheduledPublication.status.contentChanged')
          : t('scheduledPublication.status.overdueBody')}
      </p>
      <p className={styles['notice-instant']}>
        {t('scheduledPublication.status.authorizedFor', { dateTime: instant })}
        {state.kind === 'needs_reconfirm' && state.isPastDue && (
          <> {t('scheduledPublication.status.pastDueNote')}</>
        )}
      </p>
      {state.attemptCount > 0 && (
        <p className={styles['notice-attempts']}>
          {t('scheduledPublication.status.attempts', { count: state.attemptCount })}
        </p>
      )}
      {state.lastError != null && <p className={styles['notice-error']}>{state.lastError}</p>}
      <div className={cx('byline-scheduled-publication-notice-actions', styles['notice-actions'])}>
        {state.actions.confirm && (
          <Button size="sm" type="button" intent="success" disabled={busy} onClick={onConfirm}>
            {t('scheduledPublication.actions.confirm')}
          </Button>
        )}
        {state.actions.reschedule && (
          <Button size="sm" type="button" intent="info" disabled={busy} onClick={onReschedule}>
            {t('scheduledPublication.actions.reschedule')}
          </Button>
        )}
        {state.actions.cancel && (
          <Button size="sm" type="button" variant="text" disabled={busy} onClick={onCancel}>
            {t('scheduledPublication.actions.cancel')}
          </Button>
        )}
      </div>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Schedule / reschedule modal
// ---------------------------------------------------------------------------

/**
 * The picker's wall time is read, not its `Date`.
 *
 * `DatePicker` reports both: `onDateChange` gives an instant, and
 * `onWallTimeChange` gives the day and clock reading the editor actually
 * selected. Only the second one can express "02:30 on a day when 02:30 does not
 * exist" — the instant has already been normalized to 03:30 by then, and an
 * ambiguous 01:30 has already been resolved to the earlier of its two instants
 * without asking. So the wall time goes to
 * `resolveScheduledPublicationWallTime`, which is the only thing here allowed
 * to turn a wall time into an instant, and which refuses or asks as required.
 */
function ScheduleModal({
  schedule,
  timeZone,
  onSubmit,
  onDismiss,
  busy,
}: {
  schedule: ScheduledPublicationInfo | null
  timeZone: string
  onSubmit: (input: SchedulePublicationInput) => Promise<void>
  onDismiss: () => void
  busy: boolean
}) {
  const { t } = useTranslation('byline-admin')
  // The instant the picker opens on. Always a real instant — either the one
  // already authorized, or a lead time from now — so seeding it never has to
  // construct a `Date` from a wall time.
  const [seedInstant] = useState<Date>(() => seedScheduleInstant(schedule))
  const [wall, setWall] = useState<ScheduledPublicationWallTime>(() =>
    wallTimeInZone(seedInstant, timeZone)
  )
  const [instantChoices, setInstantChoices] = useState<ScheduledPublicationInstantChoice[]>([])
  const [selectedInstant, setSelectedInstant] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const resetResolution = () => {
    setInstantChoices([])
    setSelectedInstant('')
    setValidationError(null)
  }

  const submit = async () => {
    const value = joinWallTime(wall)
    if (value == null) {
      setValidationError(t('scheduledPublication.form.invalid'))
      return
    }

    const resolution = resolveScheduledPublicationWallTime(value, timeZone)
    if (resolution.status === 'invalid') {
      setValidationError(t('scheduledPublication.form.invalid'))
      return
    }
    if (resolution.status === 'nonexistent') {
      setValidationError(t('scheduledPublication.form.nonexistent'))
      return
    }
    if (
      resolution.choices.length > 1 &&
      !resolution.choices.some((c) => c.iso === selectedInstant)
    ) {
      setInstantChoices(resolution.choices)
      setValidationError(t('scheduledPublication.form.ambiguous'))
      return
    }

    const publishAtIso = selectedInstant || resolution.choices[0]?.iso
    if (publishAtIso == null) return
    await onSubmit({ publishAt: publishAtIso })
  }

  const title =
    schedule == null
      ? t('scheduledPublication.form.scheduleTitle')
      : t('scheduledPublication.form.rescheduleTitle')

  return (
    <Modal
      isOpen
      closeOnOverlayClick={!busy}
      onDismiss={() => {
        if (!busy) onDismiss()
      }}
    >
      <Modal.Container style={{ maxWidth: '560px' }}>
        <Modal.Header className={styles.modalHead}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <IconButton
            aria-label={t('common.actions.close')}
            size="xs"
            disabled={busy}
            onClick={onDismiss}
          >
            <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
          </IconButton>
        </Modal.Header>
        <Modal.Content>
          <div className={styles.field}>
            <DatePicker
              id="scheduled-publication-at"
              name="scheduled-publication-at"
              label={t('scheduledPublication.form.dateTime')}
              mode="datetime"
              inputSize="sm"
              yearsInPast={0}
              yearsInFuture={5}
              initialValue={seedInstant}
              onWallTimeChange={(value) => {
                if (value == null) return
                setWall(value)
                resetResolution()
              }}
            />
          </div>
          <p className={styles.help}>{t('scheduledPublication.form.timeZone', { timeZone })}</p>
          {instantChoices.length > 1 && (
            <div className={styles.choice}>
              <Label
                id="scheduled-publication-offset-label"
                htmlFor="scheduled-publication-offset"
                label={t('scheduledPublication.form.offset')}
              />
              <Select<string>
                id="scheduled-publication-offset"
                name="scheduled-publication-offset"
                ariaLabel={t('scheduledPublication.form.offset')}
                size="sm"
                value={selectedInstant}
                items={instantChoices.map((choice) => ({
                  value: choice.iso,
                  label: choice.offsetLabel,
                }))}
                onValueChange={(value) => {
                  setSelectedInstant(value ?? '')
                  setValidationError(null)
                }}
                disabled={busy}
              />
            </div>
          )}
          {validationError != null && (
            <p className={styles.validation} role="alert">
              {validationError}
            </p>
          )}
          <p className={styles.warningText}>{t('scheduledPublication.form.editWarning')}</p>
        </Modal.Content>
        <Modal.Actions>
          <Button size="sm" intent="noeffect" disabled={busy} onClick={onDismiss}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            intent="primary"
            disabled={busy || wall.date.length === 0 || wall.time.length === 0}
            onClick={submit}
          >
            {busy
              ? t('scheduledPublication.form.saving')
              : schedule == null
                ? t('scheduledPublication.actions.schedule')
                : t('scheduledPublication.actions.reschedule')}
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
