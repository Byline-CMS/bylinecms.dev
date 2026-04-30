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
import { Alert, Button, Container, Section } from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './route-error.module.css'

const ERROR_TITLES: Record<string, string> = {
  [ErrorCodes.NOT_FOUND]: 'Not Found',
  [ErrorCodes.VALIDATION]: 'Validation Error',
  [ErrorCodes.CONFLICT]: 'Conflict',
  [ErrorCodes.INVALID_TRANSITION]: 'Invalid Transition',
  [ErrorCodes.PATCH_FAILED]: 'Update Failed',
  [ErrorCodes.DATABASE]: 'Database Error',
  [ErrorCodes.STORAGE]: 'Storage Error',
  [ErrorCodes.UNHANDLED]: 'Unexpected Error',
}

function getErrorTitle(error: unknown): string {
  if (error instanceof BylineError) {
    return ERROR_TITLES[error.code] ?? 'Unexpected Error'
  }
  return 'Unexpected Error'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof BylineError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred. Please try again.'
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <Section className={cx('byline-route-error', styles.section)}>
      <Container className={cx('byline-route-error-container', styles.container)}>
        <Alert intent="danger" icon close={false} title={getErrorTitle(error)}>
          <p className={cx('byline-route-error-message', styles.message)}>
            {getErrorMessage(error)}
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
              Try again
            </Button>
            <a href="/" className={cx('byline-route-error-link', styles.link)}>
              Go to homepage
            </a>
          </div>
        </Alert>
      </Container>
    </Section>
  )
}

export function RouteNotFound(_props: NotFoundRouteProps) {
  return (
    <Section className={cx('byline-route-error', styles.section)}>
      <Container className={cx('byline-route-error-container', styles.container)}>
        <Alert intent="warning" icon close={false} title="Page Not Found">
          <p className={cx('byline-route-error-message', styles.message)}>
            The page you are looking for does not exist or has been moved.
          </p>
          <div className={cx('byline-route-error-actions', styles.actions)}>
            <a href="/" className={cx('byline-route-error-link', styles.link)}>
              Go to homepage
            </a>
          </div>
        </Alert>
      </Container>
    </Section>
  )
}

/**
 * Minimal fallback for when providers may be broken. Used at the root
 * route, where wrapping in Container/Section may itself be unsafe.
 */
export function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className={cx('byline-root-error', styles.rootRoot)}>
      <div className={cx('byline-root-error-inner', styles.rootInner)}>
        <h1 className={cx('byline-root-error-title', styles.rootTitle)}>Something went wrong</h1>
        <p className={cx('byline-root-error-detail', styles.rootDetail)}>
          {getErrorMessage(error)}
        </p>
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
