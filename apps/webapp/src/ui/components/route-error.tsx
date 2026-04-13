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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RouteError
// ---------------------------------------------------------------------------

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <Section className="py-12">
      <Container className="mt-[8vh] sm:mt-[12vh] max-w-2xl">
        <Alert intent="danger" icon close={false} title={getErrorTitle(error)}>
          <p className="mt-1">{getErrorMessage(error)}</p>
          <div className="mt-4 flex gap-3">
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
            <a href="/" className="inline-flex items-center text-sm underline hover:no-underline">
              Go to homepage
            </a>
          </div>
        </Alert>
      </Container>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// RouteNotFound
// ---------------------------------------------------------------------------

export function RouteNotFound(_props: NotFoundRouteProps) {
  return (
    <Section className="py-12">
      <Container className="mt-[8vh] sm:mt-[12vh] max-w-2xl">
        <Alert intent="warning" icon close={false} title="Page Not Found">
          <p className="mt-1">The page you are looking for does not exist or has been moved.</p>
          <div className="mt-4">
            <a href="/" className="inline-flex items-center text-sm underline hover:no-underline">
              Go to homepage
            </a>
          </div>
        </Alert>
      </Container>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// RootError — minimal fallback for when providers may be broken
// ---------------------------------------------------------------------------

export function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400">Something went wrong</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{getErrorMessage(error)}</p>
        <button
          type="button"
          onClick={reset}
          className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
