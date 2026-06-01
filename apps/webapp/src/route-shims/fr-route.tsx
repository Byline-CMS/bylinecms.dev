/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Literal-locale shim route for `/fr`. See `locale-home-shim.tsx` for
 * the motivation. Adding a new locale: copy this file as `<lng>-route.tsx`,
 * change the route path + locale constant, then add a corresponding
 * `route('/<lng>', ...)` entry in `routes.virtual.ts`.
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  LocaleHomeShimComponent,
  loadLocaleHomeShimData,
  localeHomeShimHead,
} from '@/route-shims/locale-home-shim'

export const Route = createFileRoute('/fr')({
  loader: () => loadLocaleHomeShimData('fr'),
  head: ({ loaderData }) => localeHomeShimHead(loaderData),
  component: RouteComponent,
})

function RouteComponent() {
  const data = Route.useLoaderData()
  return <LocaleHomeShimComponent data={data} />
}
