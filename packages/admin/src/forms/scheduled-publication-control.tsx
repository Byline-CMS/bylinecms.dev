'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Button, CloseIcon, IconButton, Modal, Select } from '@byline/ui/react'
import cx from 'clsx'

import styles from './scheduled-publication-control.module.css'
import { resolveScheduledPublicationWallTime } from './scheduled-publication-time.js'
import type { ScheduledPublicationInstantChoice } from './scheduled-publication-time.js'

export interface ScheduledPublicationInfo {
  publishAt: string | Date
  targetVersionId: string
  state: 'armed' | 'needs_reconfirm'
  lastAuthorizedBy: string | null
  lastError: string | null
  nextAttemptAt: string | Date
  attemptCount: number
}

export interface SchedulePublicationInput {
  publishAt: string
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function wallValue(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function initialWallValue(schedule: ScheduledPublicationInfo | null, timeZone: string): string {
  if (schedule != null) return wallValue(new Date(schedule.publishAt), timeZone)
  const suggested = new Date(Date.now() + 15 * 60_000)
  suggested.setSeconds(0, 0)
  return wallValue(suggested, timeZone)
}

export function ScheduledPublicationControl({
  schedule,
  onSchedule,
  onConfirm,
  onCancel,
  hasUnsavedChanges,
  onUnsavedChanges,
}: {
  schedule: ScheduledPublicationInfo | null
  onSchedule?: (input: SchedulePublicationInput) => Promise<void>
  onConfirm?: () => Promise<void>
  onCancel?: () => Promise<void>
  hasUnsavedChanges: boolean
  onUnsavedChanges: () => void
}) {
  const { t } = useTranslation('byline-admin')
  const timeZone = useMemo(browserTimeZone, [])
  const [showSchedule, setShowSchedule] = useState(false)
  const [wallTime, setWallTime] = useState('')
  const [instantChoices, setInstantChoices] = useState<ScheduledPublicationInstantChoice[]>([])
  const [selectedInstant, setSelectedInstant] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const publishAt = schedule == null ? null : new Date(schedule.publishAt)
  const overdue =
    schedule?.state === 'armed' && publishAt != null && publishAt.getTime() <= Date.now()
  const displayInstant =
    publishAt == null
      ? ''
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone,
        }).format(publishAt)

  const openSchedule = () => {
    if (hasUnsavedChanges) {
      onUnsavedChanges()
      return
    }
    setWallTime(initialWallValue(schedule, timeZone))
    setInstantChoices([])
    setSelectedInstant('')
    setValidationError(null)
    setShowSchedule(true)
  }

  const submitSchedule = async () => {
    if (onSchedule == null) return
    const resolution = resolveScheduledPublicationWallTime(wallTime, timeZone)
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
    setBusy(true)
    try {
      await onSchedule({ publishAt: publishAtIso })
      setShowSchedule(false)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
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
  }

  const cancel = async () => {
    if (onCancel == null) return
    setBusy(true)
    try {
      await onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={cx('byline-scheduled-publication', styles.root)}>
        {schedule == null ? (
          onSchedule != null && (
            <Button size="sm" type="button" intent="info" onClick={openSchedule}>
              {t('scheduledPublication.actions.schedule')}
            </Button>
          )
        ) : (
          <>
            <div
              className={cx(
                'byline-scheduled-publication-summary',
                styles.summary,
                (overdue || schedule.state === 'needs_reconfirm') && styles.warning
              )}
            >
              <strong>
                {schedule.state === 'needs_reconfirm'
                  ? t('scheduledPublication.status.needsReconfirm')
                  : overdue
                    ? t('scheduledPublication.status.overdue')
                    : t('scheduledPublication.status.scheduled')}
              </strong>{' '}
              <span>{displayInstant}</span> <span className={styles.zone}>({timeZone})</span>
              {schedule.state === 'needs_reconfirm' && (
                <span className={styles.reason}>
                  {t('scheduledPublication.status.contentChanged')}
                </span>
              )}
              {schedule.lastError != null && (
                <span className={styles.error}>{schedule.lastError}</span>
              )}
            </div>
            <div className={cx('byline-scheduled-publication-actions', styles.actions)}>
              {schedule.state === 'needs_reconfirm' && onConfirm != null && (
                <Button size="sm" type="button" intent="success" disabled={busy} onClick={confirm}>
                  {t('scheduledPublication.actions.confirm')}
                </Button>
              )}
              {onSchedule != null && (
                <Button
                  size="sm"
                  type="button"
                  variant="text"
                  disabled={busy}
                  onClick={openSchedule}
                >
                  {t('scheduledPublication.actions.reschedule')}
                </Button>
              )}
              {onCancel != null && (
                <Button size="sm" type="button" variant="text" disabled={busy} onClick={cancel}>
                  {t('scheduledPublication.actions.cancel')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={showSchedule}
        closeOnOverlayClick={!busy}
        onDismiss={() => {
          if (!busy) setShowSchedule(false)
        }}
      >
        <Modal.Container style={{ maxWidth: '560px' }}>
          <Modal.Header className={styles.modalHead}>
            <h3 className={styles.modalTitle}>
              {schedule == null
                ? t('scheduledPublication.form.scheduleTitle')
                : t('scheduledPublication.form.rescheduleTitle')}
            </h3>
            <IconButton
              arial-label={t('common.actions.close')}
              size="xs"
              disabled={busy}
              onClick={() => setShowSchedule(false)}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <label className={styles.label} htmlFor="scheduled-publication-wall-time">
              {t('scheduledPublication.form.dateTime')}
            </label>
            <input
              id="scheduled-publication-wall-time"
              className={styles.input}
              type="datetime-local"
              value={wallTime}
              disabled={busy}
              onChange={(event) => {
                setWallTime(event.currentTarget.value)
                setInstantChoices([])
                setSelectedInstant('')
                setValidationError(null)
              }}
            />
            <p className={styles.help}>{t('scheduledPublication.form.timeZone', { timeZone })}</p>
            {instantChoices.length > 1 && (
              <div className={styles.choice}>
                <label className={styles.label} htmlFor="scheduled-publication-offset">
                  {t('scheduledPublication.form.offset')}
                </label>
                <Select<string>
                  id="scheduled-publication-offset"
                  name="scheduled-publication-offset"
                  ariaLabel={t('scheduledPublication.form.offset')}
                  value={selectedInstant}
                  items={instantChoices.map((choice) => ({
                    value: choice.iso,
                    label: `${choice.offsetLabel} — ${choice.iso}`,
                  }))}
                  onValueChange={(value) => {
                    setSelectedInstant(value ?? '')
                    setValidationError(null)
                  }}
                  disabled={busy}
                />
              </div>
            )}
            {validationError != null && <p className={styles.validation}>{validationError}</p>}
            <p className={styles.warningText}>{t('scheduledPublication.form.editWarning')}</p>
          </Modal.Content>
          <Modal.Actions>
            <Button
              size="sm"
              intent="noeffect"
              disabled={busy}
              onClick={() => setShowSchedule(false)}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              intent="primary"
              disabled={busy || !wallTime}
              onClick={submitSchedule}
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
    </>
  )
}
