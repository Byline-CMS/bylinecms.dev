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

import type { ReactNode, RefObject } from 'react'

import type { SlugifierFn, StructuralMutationReceipt, WorkflowStatus } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, ComboButton, LoaderEllipsis } from '@byline/ui/react'
import cx from 'clsx'

import { AvailableLocalesWidget } from './available-locales-widget'
import { DocumentActions, type DocumentActionsLocaleOption } from './document-actions'
import styles from './form-renderer.module.css'
import { FormStatusDisplay } from './form-status-display'
import { PathWidget } from './path-widget'
import {
  ScheduledPublicationCell,
  ScheduledPublicationNotice,
  type UseScheduledPublicationReturn,
} from './scheduled-publication-control'
import { TreePlacementWidget } from './tree-placement-widget'
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
  const runTransition = async (status: string) => {
    if (isBlocked() || !onStatusChange) return
    if (hasChanges) {
      onUnsavedChanges()
      return
    }
    onStatusBusyChange(true)
    try {
      await onStatusChange(status)
    } catch (error) {
      onMutationError?.(error)
    } finally {
      onStatusBusyChange(false)
    }
  }

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
              onOptionSelect={runTransition}
              onButtonClick={isTerminal ? undefined : () => runTransition(primaryStatus.name)}
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

export interface FormConcurrencyNoticesProps {
  /** Mutations blocked or a discard in flight. */
  disabled: boolean
  mutationIssue?: 'stale' | 'reload' | 'lock' | 'unavailable' | 'committed' | null
  scheduledPublicationsNeedReconfirmation?: boolean
  scheduledPublicationsHref?: string
  /**
   * Focus target when a mutation issue appears. The ref belongs to the form
   * component, which restores focus after a save; this region only attaches it.
   */
  warningRef: RefObject<HTMLDivElement | null>
  discarding: boolean
  reloadFailed: boolean
  onDiscardRequested: () => void
  scheduling: UseScheduledPublicationReturn
  restoreWarnings?: string[]
}

export const FormConcurrencyNotices = ({
  disabled,
  mutationIssue,
  scheduledPublicationsNeedReconfirmation,
  scheduledPublicationsHref,
  warningRef,
  discarding,
  reloadFailed,
  onDiscardRequested,
  scheduling,
  restoreWarnings,
}: FormConcurrencyNoticesProps): ReactNode => {
  const { t } = useTranslation('byline-admin')

  return (
    <>
      {(mutationIssue || scheduledPublicationsNeedReconfirmation) && (
        <div
          ref={warningRef}
          tabIndex={-1}
          role="alert"
          aria-live="assertive"
          className={cx('byline-document-concurrency', styles.concurrency)}
        >
          {mutationIssue && (
            <Alert
              intent="warning"
              icon
              close={false}
              title={t(`documentConcurrency.${mutationIssue}Title`)}
            >
              <p>{t(`documentConcurrency.${mutationIssue}`)}</p>
              {mutationIssue !== 'committed' && (
                <Button type="button" disabled={discarding} onClick={onDiscardRequested}>
                  {t('documentConcurrency.reloadAction')}
                </Button>
              )}
              {reloadFailed && <p>{t('documentConcurrency.reloadFailed')}</p>}
            </Alert>
          )}
          {scheduledPublicationsNeedReconfirmation && (
            <Alert
              intent="warning"
              icon
              close={false}
              title={t('documentConcurrency.schedulesTitle')}
            >
              <p>{t('documentConcurrency.schedules')}</p>
              {scheduledPublicationsHref && (
                <a href={scheduledPublicationsHref}>{t('documentConcurrency.reviewSchedules')}</a>
              )}
            </Alert>
          )}
        </div>
      )}
      <ScheduledPublicationNotice
        state={scheduling.state}
        timeZone={scheduling.timeZone}
        busy={disabled || scheduling.busy}
        onConfirm={scheduling.confirm}
        onReschedule={scheduling.openSchedule}
        onCancel={scheduling.cancel}
      />
      {scheduling.modal}
      {restoreWarnings && restoreWarnings.length > 0 && (
        <Alert
          className="m-0 mt-4"
          intent="warning"
          icon={true}
          close={false}
          title={t('forms.restoreWarnings.title')}
        >
          <p>{t('forms.restoreWarnings.body', { count: restoreWarnings.length })}</p>
          <ul>
            {restoreWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  )
}

export interface FormSidebarWidgetsProps {
  /** Mutations blocked or a discard in flight. */
  disabled: boolean
  mode: 'create' | 'edit'
  // biome-ignore lint/suspicious/noExplicitAny: document shape is collection-specific
  initialData?: any
  collectionPath?: string
  defaultLocale: string
  contentLocale: string
  contentLocales?: ReadonlyArray<DocumentActionsLocaleOption>
  showPath: boolean
  useAsPath?: string
  lockPath?: boolean
  pathSlugifier?: SlugifierFn
  pathSourceLocked?: boolean
  tree?: boolean
  useAsTitle?: string
  advertiseLocales?: boolean
  observedRevision?: number
  onMutationError?: (error: unknown) => 'blocked' | 'committed' | null | void
  onTreeMutationCommitted?: (receipt: StructuralMutationReceipt) => void
}

/**
 * The page-level widgets in the editor's sidebar: path, tree placement and
 * advertised locales. They are page concerns rather than schema fields, so they
 * reach `FormLayout` through its `sidebarSlot` and the embedded creation view
 * passes none of them.
 */
export const FormSidebarWidgets = ({
  disabled,
  mode,
  initialData,
  collectionPath,
  defaultLocale,
  contentLocale,
  contentLocales,
  showPath,
  useAsPath,
  lockPath,
  pathSlugifier,
  pathSourceLocked,
  tree,
  useAsTitle,
  advertiseLocales,
  observedRevision,
  onMutationError,
  onTreeMutationCommitted,
}: FormSidebarWidgetsProps): ReactNode => (
  <>
    {/* A locked collection's widget renders even with no `useAsPath`
        and nothing stored yet: its path is managed, and the editor
        needs to see that. `showPath: false` still wins — it marks a
        path that must never be presented at all. */}
    {showPath &&
      (useAsPath ||
        lockPath === true ||
        (typeof initialData?.path === 'string' && initialData.path.length > 0)) && (
        <PathWidget
          disabled={disabled}
          useAsPath={useAsPath}
          collectionPath={collectionPath ?? ''}
          defaultLocale={defaultLocale}
          activeLocale={contentLocale}
          mode={mode}
          slugifier={pathSlugifier}
          sourceLocked={pathSourceLocked}
          lockPath={lockPath}
        />
      )}
    {tree && mode === 'edit' && typeof initialData?.id === 'string' && (
      <TreePlacementWidget
        disabled={disabled}
        onMutationError={onMutationError}
        onCommitted={onTreeMutationCommitted}
        expectedRevision={observedRevision ?? initialData.revision}
        collectionPath={collectionPath ?? ''}
        documentId={initialData.id as string}
        useAsTitle={useAsTitle}
      />
    )}
    {advertiseLocales && (
      <AvailableLocalesWidget
        disabled={disabled}
        contentLocales={contentLocales ?? []}
        availableVersionLocales={
          (initialData?._availableVersionLocales as string[] | undefined) ?? []
        }
      />
    )}
  </>
)
