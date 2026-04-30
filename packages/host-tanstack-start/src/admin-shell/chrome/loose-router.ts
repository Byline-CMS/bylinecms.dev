/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Loosely-typed re-exports of TanStack Router primitives. The package
 * has no view of the host's generated route tree at type-check time, so
 * the strict generic typing on `Link` and `useNavigate` collapses
 * `params`/`search`/`to` to `never`. These wrappers relax the call
 * signature; runtime behaviour is identical.
 */

import type React from 'react'
import { Link as TanStackLink, useNavigate as useTanStackNavigate } from '@tanstack/react-router'

export interface LooseLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string
  // biome-ignore lint/suspicious/noExplicitAny: untyped router params
  params?: Record<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: untyped router search
  search?: any
  resetScroll?: boolean
  replace?: boolean
  // biome-ignore lint/suspicious/noExplicitAny: untyped passthrough props
  [key: string]: any
}

export const Link = TanStackLink as unknown as (props: LooseLinkProps) => React.JSX.Element

export interface LooseNavigateOpts {
  to?: string
  // biome-ignore lint/suspicious/noExplicitAny: untyped router params
  params?: Record<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: untyped router search
  search?: any
  replace?: boolean
  // biome-ignore lint/suspicious/noExplicitAny: untyped passthrough
  [key: string]: any
}

export type LooseNavigate = (opts: LooseNavigateOpts) => void

export function useNavigate(): LooseNavigate {
  return useTanStackNavigate() as unknown as LooseNavigate
}
