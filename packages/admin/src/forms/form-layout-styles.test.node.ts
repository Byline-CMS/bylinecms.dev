/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// jsdom applies no stylesheet, so the one-column guarantee of the stacked
// variant cannot be asserted by rendering. This reads the stylesheet directly:
// the class has to exist, and it must not be swept into the two-column grid
// rule that the split layout gets at >=60rem.
const css = readFileSync(join(__dirname, 'form-renderer.module.css'), 'utf8')

describe('stacked form layout styles', () => {
  it('defines the stacked layout class', () => {
    expect(css).toMatch(/\.layout-stacked\b/)
    expect(css).toMatch(/:global\(\.byline-form-layout-stacked\)/)
  })

  it('does not put the stacked class in the two-column grid rule', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 60rem)'))
    const gridRule = desktop.slice(0, desktop.indexOf('}\n}') + 3)
    expect(gridRule).toContain('grid-template-columns')
    expect(gridRule).not.toContain('layout-stacked')
  })
})
