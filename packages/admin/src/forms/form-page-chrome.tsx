'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Page-level chrome for the full-page document editor: the parts that frame a
 * form rather than render it. The embedded creation view renders none of this.
 *
 * Each component takes only the props it needs — deliberately not a
 * `FormRendererProps` pass-through, so what a region actually depends on stays
 * visible at its call site.
 */

import type { ReactNode } from 'react'

import type { WorkflowStatus } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, ComboButton, LoaderEllipsis } from '@byline/ui/react'
import cx from 'clsx'

import { DocumentActions, type DocumentActionsLocaleOption } from './document-actions'
import styles from './form-renderer.module.css'
import { FormStatusDisplay } from './form-status-display'
import {
  ScheduledPublicationCell,
  type UseScheduledPublicationReturn,
} from './scheduled-publication-control'
import type { PublishedVersionInfo } from './form-renderer'
import type { StatusTransitions } from './status-transitions'

export interface FormHeadingRowProps {
  heading: ReactNode
  /** Host-supplied controls rendered beside the heading (locale switcher, …). */
  headerSlot?: ReactNode
}

export const FormHeadingRow = ({ heading, headerSlot }: FormHeadingRowProps): ReactNode => (
  <div className={cx('byline-form-heading-row', styles['heading-row'])}>
    <h1 className={cx('byline-form-heading', styles.heading)}>{heading}</h1>
    {/* Source-locale anchor indicator removed pending heading-layout work.
        To re-enable: render `<SourceLocaleBadge locale={sourceLocale} />`
        here from `initialData.sourceLocale` (mismatch-only is the intended
        end state). See docs/08-internationalization/index.md. */}
    {headerSlot}
  </div>
)

export interface FormStatusBarProps {
  /** Mutations blocked or a discard in flight. */
  disabled: boolean
  // biome-ignore lint/suspicious/noExplicitAny: document shape is collection-specific
  initialData?: any
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  scheduling: UseScheduledPublicationReturn
  hasChanges: boolean
  isUploading: boolean
  isSubmitting: boolean
  onCancel: () => void
  /** Status transitions, already computed for the current workflow position. */
  transitions: StatusTransitions
  statusBusy: boolean
  onStatusBusyChange: (busy: boolean) => void
  onStatusChange?: (nextStatus: string) => Promise<void>
  onMutationError?: (error: unknown) => 'blocked' | 'committed' | null | void
  /** Read synchronously at click time, not at render time. */
  isBlocked: () => boolean
  /** A guarded action was attempted while the form is dirty. */
  onUnsavedChanges: () => void
  onUnpublish?: () => Promise<void>
  onDelete?: () => Promise<void>
  onDuplicate?: () => Promise<void>
  onCopyToLocale?: (args: { targetLocale: string; overwrite: boolean }) => Promise<void>
  onDeleteLocale?: (args: { targetLocale: string }) => Promise<void>
  useAsTitle?: string
  contentLocale: string
  contentLocales?: ReadonlyArray<DocumentActionsLocaleOption>
  defaultLocale: string
}

export const FormStatusBar = ({
  disabled,
  initialData,
  workflowStatuses,
  publishedVersion,
  scheduling,
  hasChanges,
  isUploading,
  isSubmitting,
  onCancel,
  transitions,
  statusBusy,
  onStatusBusyChange,
  onStatusChange,
  onMutationError,
  isBlocked,
  onUnsavedChanges,
  onUnpublish,
  onDelete,
  onDuplicate,
  onCopyToLocale,
  onDeleteLocale,
  useAsTitle,
  contentLocale,
  contentLocales,
  defaultLocale,
}: FormStatusBarProps): ReactNode => {
  const { t } = useTranslation('byline-admin')
  const { primaryStatus, secondaryStatuses, isTerminal } = transitions

  return (
    <div className={cx('byline-form-status-bar', styles['status-bar'])}>
      <div className={cx('byline-form-status-details', styles['status-details'])}>
        <FormStatusDisplay
          disabled={disabled}
          initialData={initialData}
          workflowStatuses={workflowStatuses}
          publishedVersion={publishedVersion}
          onUnpublish={onUnpublish}
          afterStatusCells={
            <ScheduledPublicationCell state={scheduling.state} timeZone={scheduling.timeZone} />
          }
        />
      </div>
      <div className={cx('byline-form-actions', styles.actions)}>
        <Button
          className={cx('byline-form-actions-button', styles['actions-button'])}
          size="sm"
          intent="noeffect"
          type="button"
          onClick={onCancel}
        >
          {hasChanges === false ? t('common.actions.close') : t('common.actions.cancel')}
        </Button>
        <Button
          className={cx('byline-form-actions-button', styles['actions-button'])}
          size="sm"
          type="submit"
          disabled={disabled || hasChanges === false || isUploading || isSubmitting}
          aria-label={isSubmitting ? t('common.actions.save') : undefined}
        >
          {isUploading ? (
            t('forms.actions.uploading')
          ) : (
            <span className={cx('byline-form-save-content', styles['save-content'])}>
              <span
                className={cx(
                  'byline-form-save-label',
                  styles['save-label'],
                  isSubmitting && styles['save-label-hidden']
                )}
              >
                {t('common.actions.save')}
              </span>
              {isSubmitting ? (
                <span className={cx('byline-form-save-loader', styles['save-loader'])}>
                  <LoaderEllipsis size={28} aria-hidden="true" />
                </span>
              ) : null}
            </span>
          )}
        </Button>
        {primaryStatus && onStatusChange && (
          <div className={cx('byline-form-actions-status-wrap', styles['actions-status-wrap'])}>
            <ComboButton
              buttonClassName={cx(
                'byline-form-actions-combo-button',
                styles['actions-combo-button']
              )}
              triggerClassName={cx(
                'byline-form-actions-combo-trigger',
                styles['actions-combo-trigger']
              )}
              options={secondaryStatuses.map((s) => ({
                label: isTerminal
                  ? t('forms.actions.revertTo', { label: s.label ?? s.name })
                  : (s.verb ?? s.label ?? s.name),
                value: s.name,
              }))}
              sideOffset={5}
              size="sm"
              type="button"
              intent={isTerminal ? 'info' : 'success'}
              disabled={disabled || statusBusy}
              onOptionSelect={async (value: string) => {
                if (isBlocked()) return
                if (hasChanges) {
                  onUnsavedChanges()
                  return
                }
                onStatusBusyChange(true)
                try {
                  await onStatusChange(value)
                } catch (error) {
                  onMutationError?.(error)
                } finally {
                  onStatusBusyChange(false)
                }
              }}
              onButtonClick={
                isTerminal
                  ? undefined
                  : async () => {
                      if (isBlocked()) return
                      if (hasChanges) {
                        onUnsavedChanges()
                        return
                      }
                      onStatusBusyChange(true)
                      try {
                        await onStatusChange(primaryStatus.name)
                      } catch (error) {
                        onMutationError?.(error)
                      } finally {
                        onStatusBusyChange(false)
                      }
                    }
              }
            >
              {statusBusy
                ? '...'
                : isTerminal
                  ? (primaryStatus.label ?? primaryStatus.name)
                  : (primaryStatus.verb ?? primaryStatus.label ?? primaryStatus.name)}
            </ComboButton>
          </div>
        )}
        <DocumentActions
          disabled={disabled}
          publishedVersion={publishedVersion}
          onUnpublish={onUnpublish}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          sourceTitle={
            useAsTitle != null && initialData != null
              ? ((initialData as Record<string, unknown>)[useAsTitle] as string | null | undefined)
              : null
          }
          onCopyToLocale={onCopyToLocale}
          sourceLocale={contentLocale}
          contentLocales={contentLocales}
          hasUnsavedChanges={hasChanges}
          onUnsavedChanges={() => onUnsavedChanges()}
          onDeleteLocale={onDeleteLocale}
          defaultLocale={defaultLocale}
          availableLocales={initialData?._availableVersionLocales as string[] | undefined}
          scheduledPublicationState={scheduling.state}
          onSchedulePublication={scheduling.openSchedule}
          onConfirmScheduledPublication={scheduling.confirm}
          onCancelScheduledPublication={scheduling.cancel}
        />
      </div>
    </div>
  )
}
