/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ current: vi.fn() }))
vi.mock('../../server-fns/auth/current-user.js', () => ({ getCurrentAdminUser: mocks.current }))
vi.mock('../../routes/sign-in-path.js', () => ({ getSignInRoutePath: () => '/sign-in' }))

import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'

import { acceptSession, expectedSession } from '../../integrations/session-coordination.js'
import { SessionChangeBoundary } from './session-change-boundary.js'

const user = (sessionId: string, email: string) => ({
  sessionId,
  email,
  id: email,
  given_name: null,
  family_name: null,
  is_super_admin: false,
  abilities: [],
})
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('BroadcastChannel', undefined)
  window.sessionStorage.clear()
  acceptSession('expected-B')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
// Mounted inside a real provider so the assertions below read the shipped
// English strings, and so the boundary's `OptionalI18nProvider` exercises its
// reuse path (an existing context is preserved rather than self-mounted).
async function render() {
  await act(async () => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <SessionChangeBoundary user={user('late-A', 'x@example.test')}>
          <button type="button">Publish</button>
        </SessionChangeBoundary>
      </I18nProvider>
    )
  })
}
describe('session-change acknowledgement', () => {
  it('blocks business UI on the first post-sign-in render when cookies select a different login', async () => {
    mocks.current.mockResolvedValue(user('late-A', 'x@example.test'))
    await render()
    expect(container.textContent).not.toContain('Publish')
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.textContent).toContain('Active account: x@example.test')
    expect(expectedSession()).toBe('expected-B')
  })
  it('requires renewed acknowledgement when the server account changes again', async () => {
    mocks.current.mockResolvedValue(user('late-A', 'x@example.test'))
    await render()
    mocks.current.mockResolvedValue(user('new-C', 'z@example.test'))
    await act(async () => {
      container.querySelector('button')?.click()
    })
    expect(container.textContent).toContain(
      'The active session changed again. Review the account before continuing.'
    )
    expect(expectedSession()).toBe('expected-B')
    expect(container.textContent).not.toContain('Publish')
  })
})
