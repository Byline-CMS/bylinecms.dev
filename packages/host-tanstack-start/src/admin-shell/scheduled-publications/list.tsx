'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { deriveScheduledPublicationState } from '@byline/admin/react'
import { useTranslation } from '@byline/i18n/react'
import {
  Alert,
  Badge,
  Button,
  Container,
  Input,
  Label,
  Section,
  Select,
  Table,
  useToastManager,
} from '@byline/ui/react'
import cx from 'clsx'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import { cancelCollectionDocumentScheduledPublish } from '../../server-fns/collections/index.js'
import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import styles from './list.module.css'
import type { ScheduledPublicationListResponse } from '../../server-fns/collections/index.js'

/**
 * Badge intent per state. Armed is informational; the two states that mean
 * automatic publication is not going to happen unaided are warnings.
 */
/** Admin account ids are UUIDs; both the route validator and the server fn insist. */
const ADMIN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATE_INTENT = {
  none: 'noeffect',
  armed: 'info',
  needs_reconfirm: 'warning',
  overdue: 'warning',
} as const

export function ScheduledPublicationsView({ data }: { data: ScheduledPublicationListResponse }) {
  const { t, locale } = useTranslation('byline-admin')
  // One clock reading for the whole render, so every row's armed/overdue
  // boundary is decided against the same instant.
  const now = Date.now()
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [])
  const instantFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }),
    [locale, timeZone]
  )
  const navigate = useNavigate()
  const toastManager = useToastManager()
  const location = useRouterState({ select: (state) => state.location })
  const search = location.search as {
    state?: 'armed' | 'needs_reconfirm'
    lastAuthorizedBy?: string
    page?: number
  }
  const [authorizer, setAuthorizer] = useState(search.lastAuthorizedBy ?? '')
  const [authorizerError, setAuthorizerError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const applySearch = (patch: Record<string, unknown>) => {
    navigate({
      to: getAdminRoutePath('scheduled-publications'),
      search: { ...(location.search as Record<string, unknown>), ...patch, page: undefined },
    })
  }

  /**
   * Check the id here rather than letting the route's search schema reject it.
   * Both the route validator and the server fn require a UUID, and a value that
   * fails either replaces the whole page with an error screen carrying a raw
   * regex — an unreasonable response to a mistyped id in a field whose entire
   * purpose is "paste an account id".
   */
  const applyAuthorizer = () => {
    const trimmed = authorizer.trim()
    if (trimmed.length > 0 && !ADMIN_ID_RE.test(trimmed)) {
      setAuthorizerError(t('scheduledPublication.list.filters.authorizerInvalid'))
      return
    }
    setAuthorizerError(null)
    applySearch({ lastAuthorizedBy: trimmed || undefined })
  }

  const cancel = async (collection: string, documentId: string) => {
    setCancelling(documentId)
    try {
      const result = await cancelCollectionDocumentScheduledPublish({
        data: { collection, id: documentId },
      })
      const cancelled = result.status === 'cancelled'
      toastManager.add({
        title: cancelled
          ? t('scheduledPublication.toast.cancelledTitle')
          : t('scheduledPublication.toast.cancelLostTitle'),
        description: cancelled
          ? t('scheduledPublication.toast.cancelledDescription')
          : t('scheduledPublication.toast.cancelLostDescription'),
        data: {
          intent: cancelled ? 'success' : 'warning',
          iconType: cancelled ? 'success' : 'warning',
          icon: true,
          close: true,
        },
      })
      navigate({
        to: getAdminRoutePath('scheduled-publications'),
        search: location.search as Record<string, unknown>,
      })
    } catch (error) {
      toastManager.add({
        title: t('scheduledPublication.toast.failedTitle'),
        description: (error as Error).message,
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    } finally {
      setCancelling(null)
    }
  }

  const unhealthy = data.runtime.health?.status !== 'healthy'

  return (
    <Section>
      <Container>
        <div className={cx('byline-scheduled-list-head', styles.head)}>
          <h1 className={styles.title}>{t('scheduledPublication.list.title')}</h1>
          <p className={styles.intro}>{t('scheduledPublication.list.intro')}</p>
        </div>

        {unhealthy && (
          <Alert
            className={styles.health}
            intent="warning"
            icon={true}
            close={false}
            title={t('scheduledPublication.list.schedulerWarningTitle')}
          >
            {t('scheduledPublication.list.schedulerWarningBody', {
              status: data.runtime.health?.status ?? 'not_started',
            })}
          </Alert>
        )}

        <div className={styles.controls}>
          <div className={styles.filters}>
            <div className={styles.filter}>
              <Label
                id="scheduled-publication-state-label"
                htmlFor="scheduled-publication-state"
                label={t('scheduledPublication.list.filters.state')}
              />
              <Select<string>
                id="scheduled-publication-state"
                name="scheduled-publication-state"
                ariaLabel={t('scheduledPublication.list.filters.state')}
                size="sm"
                value={search.state ?? '_all'}
                items={[
                  { value: '_all', label: t('scheduledPublication.list.filters.allStates') },
                  { value: 'armed', label: t('scheduledPublication.list.states.armed') },
                  {
                    value: 'needs_reconfirm',
                    label: t('scheduledPublication.list.states.needsReconfirm'),
                  },
                ]}
                onValueChange={(value) =>
                  applySearch({ state: value === '_all' ? undefined : value })
                }
              />
            </div>
            <div className={cx(styles.filter, styles['filter-authorizer'])}>
              <Input
                id="scheduled-publication-authorizer"
                name="scheduled-publication-authorizer"
                inputSize="sm"
                label={t('scheduledPublication.list.filters.authorizer')}
                value={authorizer}
                error={authorizerError != null}
                errorText={authorizerError ?? ''}
                onChange={(event) => {
                  setAuthorizer(event.currentTarget.value)
                  setAuthorizerError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyAuthorizer()
                  }
                }}
              />
            </div>
            <div className={styles['filter-actions']}>
              <Button size="sm" type="button" onClick={applyAuthorizer}>
                {t('scheduledPublication.list.filters.apply')}
              </Button>
              {(search.state != null || search.lastAuthorizedBy != null) && (
                <Button
                  size="sm"
                  type="button"
                  variant="text"
                  onClick={() => {
                    setAuthorizer('')
                    setAuthorizerError(null)
                    navigate({ to: getAdminRoutePath('scheduled-publications'), search: {} })
                  }}
                >
                  {t('scheduledPublication.list.filters.clear')}
                </Button>
              )}
            </div>
          </div>
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="scheduledPublicationsPagerTop"
            aria-label={t('scheduledPublication.list.pagerAriaLabel')}
          />
        </div>
        {/* Kept out of the input's own help slot: hanging below one field made
            it taller than its neighbour, and a row aligned on its controls then
            pushed the state filter out of line with it. */}
        <p className={styles['filters-help']}>
          {t('scheduledPublication.list.filters.authorizerHelp')}
        </p>

        {data.schedules.length === 0 ? (
          <p className={styles.empty}>{t('scheduledPublication.list.empty')}</p>
        ) : (
          <Table.Container className={styles.tableWrap}>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.document')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.publishAt')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.state')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.authorizer')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.attempt')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.actions')}
                  </Table.HeadingCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.schedules.map((schedule) => {
                  // Same derivation the document editor uses, so a row here and
                  // the document it links to can never disagree about whether a
                  // schedule has gone overdue.
                  const state = deriveScheduledPublicationState(
                    schedule,
                    { canSchedule: false, canConfirm: false, canCancel: true },
                    now
                  )
                  const publishAt = new Date(schedule.publishAt)
                  return (
                    <Table.Row key={schedule.documentId}>
                      <Table.Cell>
                        <Link
                          to={getAdminRoutePath('collections', '$collection', '$id')}
                          params={{
                            collection: schedule.collectionPath,
                            id: schedule.documentId,
                          }}
                        >
                          {schedule.documentPath || schedule.documentId}
                        </Link>
                        <span className={styles.collection}>{schedule.collectionLabel}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <time className={styles.instant} dateTime={publishAt.toISOString()}>
                          {instantFormat.format(publishAt)}
                        </time>
                        <span className={styles.zone}>{timeZone}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge intent={STATE_INTENT[state.kind]}>
                          {state.kind === 'needs_reconfirm'
                            ? t('scheduledPublication.list.states.needsReconfirm')
                            : state.kind === 'overdue'
                              ? t('scheduledPublication.list.states.overdue')
                              : t('scheduledPublication.list.states.armed')}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <span className={styles.authorizer}>
                          {schedule.lastAuthorizedBy ?? '—'}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span>{schedule.attemptCount}</span>
                        {schedule.lastError != null && (
                          <span className={styles.error}>{schedule.lastError}</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          size="sm"
                          type="button"
                          variant="text"
                          disabled={cancelling === schedule.documentId}
                          onClick={() => cancel(schedule.collectionPath, schedule.documentId)}
                        >
                          {t('scheduledPublication.actions.cancel')}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </Table.Container>
        )}

        <div className={styles.pagerBottom}>
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="scheduledPublicationsPagerBottom"
            aria-label={t('scheduledPublication.list.pagerAriaLabel')}
          />
        </div>
      </Container>
    </Section>
  )
}
