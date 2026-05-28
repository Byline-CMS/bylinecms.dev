/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Route-level error and not-found components for TanStack Router.
 *
 * These are designed to be used as `errorComponent` and `notFoundComponent`
 * on layout routes (root, admin, public) so that errors render inside the
 * appropriate shell rather than blowing away the entire page.
 */

import type { ErrorComponentProps, NotFoundRouteProps } from '@tanstack/react-router'
import { useRouter } from '@tanstack/react-router'

import { BylineError, ErrorCodes } from '@byline/core'
import type { UseTranslationReturn } from '@byline/i18n/react'
import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, Container, Section } from '@byline/ui/react'
import cx from 'classnames'

import styles from './route-error.module.css'

// Static map from ErrorCode → translation key. Resolved to a localised
// string at render time via the `t` function below — module-scope
// strings would otherwise freeze the English copy in.
const ERROR_TITLE_KEYS: Record<string, string> = {
  [ErrorCodes.NOT_FOUND]: 'routeError.titles.notFound',
  [ErrorCodes.VALIDATION]: 'routeError.titles.validation',
  [ErrorCodes.CONFLICT]: 'routeError.titles.conflict',
  [ErrorCodes.INVALID_TRANSITION]: 'routeError.titles.invalidTransition',
  [ErrorCodes.PATCH_FAILED]: 'routeError.titles.patchFailed',
  [ErrorCodes.DATABASE]: 'routeError.titles.database',
  [ErrorCodes.STORAGE]: 'routeError.titles.storage',
  [ErrorCodes.UNHANDLED]: 'routeError.titles.unhandled',
}

type Translate = UseTranslationReturn['t']

function getErrorTitle(error: unknown, t: Translate): string {
  if (error instanceof BylineError) {
    return t(ERROR_TITLE_KEYS[error.code] ?? 'routeError.titles.unhandled')
  }
  return t('routeError.titles.unhandled')
}

function getErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof BylineError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return t('routeError.defaultMessage')
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const { t } = useTranslation('byline-admin')

  return (
    <Section className={cx('byline-route-error', styles.section)}>
      <Container className={cx('byline-route-error-container', styles.container)}>
        <Alert intent="danger" icon close={false} title={getErrorTitle(error, t)}>
          <p className={cx('byline-route-error-message', styles.message)}>
            {getErrorMessage(error, t)}
          </p>
          <div className={cx('byline-route-error-actions', styles.actions)}>
            <Button
              variant="outlined"
              size="sm"
              intent="danger"
              onClick={() => {
                reset()
                router.invalidate()
              }}
            >
              {t('common.actions.tryAgain')}
            </Button>
            <a href="/" className={cx('byline-route-error-link', styles.link)}>
              {t('common.actions.goToHomepage')}
            </a>
          </div>
        </Alert>
      </Container>
    </Section>
  )
}

export function RouteNotFound(_props: NotFoundRouteProps) {
  const { t } = useTranslation('byline-admin')
  return (
    <Section className={cx('byline-route-error', styles.section)}>
      <Container className={cx('byline-route-error-container', styles.container)}>
        <Alert intent="warning" icon close={false} title={t('routeError.notFound.title')}>
          <p className={cx('byline-route-error-message', styles.message)}>
            {t('routeError.notFound.message')}
          </p>
          <div className={cx('byline-route-error-actions', styles.actions)}>
            <a href="/" className={cx('byline-route-error-link', styles.link)}>
              {t('common.actions.goToHomepage')}
            </a>
          </div>
        </Alert>
      </Container>
    </Section>
  )
}

/**
 * Minimal fallback for when providers may be broken — used at the root
 * route where the i18n provider itself may not be mounted. Stays in
 * English on purpose.
 */
export function RootError({ error, reset }: ErrorComponentProps) {
  function rootMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return 'An unexpected error occurred. Please try again.'
  }

  return (
    <div className={cx('byline-root-error', styles.rootRoot)}>
      <div className={cx('byline-root-error-inner', styles.rootInner)}>
        <h1 className={cx('byline-root-error-title', styles.rootTitle)}>Something went wrong</h1>
        <p className={cx('byline-root-error-detail', styles.rootDetail)}>{rootMessage(error)}</p>
        <button
          type="button"
          onClick={reset}
          className={cx('byline-root-error-button', styles.rootButton)}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
