/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

it('collects and renders React component tests in jsdom mode', () => {
  const reactGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  act(() => root.render(<span data-testid="probe">jsdom ready</span>))
  expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('jsdom ready')

  act(() => root.unmount())
  container.remove()
  delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
})
