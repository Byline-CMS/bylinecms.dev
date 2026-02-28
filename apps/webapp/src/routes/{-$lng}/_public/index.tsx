/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { EditorAnimation } from '@/modules/home/editor-animation'
import { FeatureGrid } from '@/modules/home/feature-grid'
import { HeroTagline } from '@/modules/home/hero-tagline'

export const Route = createFileRoute('/{-$lng}/_public/')({
  component: Index,
})

function Index() {
  return (
    <>
      <HeroTagline />
      <EditorAnimation />
      <FeatureGrid />
    </>
  )
}
