/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Route-level error and not-found components for TanStack Router.
 *
 * Layered:
 *   - `RootError` is wired to `__root.tsx` and is intentionally
 *     dependency-free (no UI kit, no providers) so it still renders
 *     when whatever broke happens to be a provider or layout.
 *   - `RouteError` / `RouteNotFound` are wired to the `_public` layout
 *     route and render inside the site chrome (header, footer) so the
 *     user has somewhere to go.
 */

import type { ErrorComponentProps, NotFoundRouteProps } from '@tanstack/react-router'
import { Link, useRouter } from '@tanstack/react-router'

import { Button, Container, Section } from '@byline/ui/react'

import { useLocaleNavigation } from '@/i18n/hooks/use-locale-navigation'
import { BackButton } from './back-button'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'An unexpected error occurred. Please try again.'
}

export function RouteNotFound(_props: NotFoundRouteProps) {
  const { lngParam } = useLocaleNavigation()
  return (
    <Section className="py-6 flex flex-1 items-center justify-center">
      <Container className="flex items-center flex-col min-h-[350px] sm:min-h-[350px] pt-[8vh] sm:pt-[50px]">
        <h1>Oops! Not found</h1>
        <p className="text-center">
          The page or resource you&apos;re looking for could not be found.
        </p>
        <div className="actions flex gap-3 py-2">
          <Button render={<Link to="/{-$lng}" params={lngParam} />}>Home</Button>
          <BackButton />
        </div>
      </Container>
    </Section>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const { lngParam } = useLocaleNavigation()
  return (
    <Section className="py-6 flex flex-1 items-center justify-center">
      <Container className="flex items-center flex-col min-h-[350px] sm:min-h-[350px] pt-[8vh] sm:pt-[50px]">
        <h1>Something went wrong</h1>
        <p className="text-center">{getErrorMessage(error)}</p>
        <div className="actions flex gap-3 py-2">
          <Button
            onClick={() => {
              reset()
              router.invalidate()
            }}
          >
            Try again
          </Button>
          <Button render={<Link to="/{-$lng}" params={lngParam} />}>Home</Button>
        </div>
      </Container>
    </Section>
  )
}

/**
 * Minimal fallback used at the root, where layout providers may themselves
 * be the source of the error. Plain elements only — no UI kit, no hooks
 * that depend on layout context.
 */
export function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-medium mb-2">Something went wrong</h1>
        <p className="mb-4 opacity-80">{getErrorMessage(error)}</p>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 rounded-md border border-current text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
