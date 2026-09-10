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

const mocks = vi.hoisted(() => ({ renew: vi.fn() }))
vi.mock('../../server-fns/auth/renew.js', () => ({ renewAdminSession: mocks.renew }))
vi.mock('../../server-fns/i18n/index.js', () => ({ setAdminLocaleFn: vi.fn() }))
vi.mock('../../integrations/byline-admin-services.js', () => ({ bylineAdminServices: {} }))
vi.mock('@byline/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@byline/core')>()
  const { adminTranslations } = await import('@byline/i18n/admin')
  return {
    ...actual,
    getAdminConfig: () => ({
      routes: { admin: '/admin' },
      i18n: {
        admin: { locales: ['en'], defaultLocale: 'en' },
        translations: adminTranslations({ locales: ['en'] }),
      },
    }),
  }
})

import { SignInPage } from './sign-in-page.js'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('BroadcastChannel', undefined)
  window.sessionStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => {
    root.render(<SignInPage redirectTo="/admin" activeLocale="en" reauthenticate={false} />)
  })
  // The bootstrap promise settles through `.catch`/`.finally` after the first
  // commit; yield one macrotask inside `act` so that state update is flushed.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('SignInPage bootstrap states', () => {
  it('renders the bootstrap error in the kit card with a kit button', async () => {
    mocks.renew.mockRejectedValue(new Error('network'))
    await render()
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.classList.contains('byline-card')).toBe(true)
    expect(alert?.querySelector('.byline-alert-danger')?.textContent).toContain(
      'Unable to check your session. Please try again.'
    )
    // The alert itself carries no dismiss button; the only button is the retry action.
    expect(alert?.querySelectorAll('button').length).toBe(1)
    const button = alert?.querySelector('.byline-sign-in-page-actions button')
    expect(button?.classList.contains('byline-button')).toBe(true)
    expect(button?.textContent).toBe('Try again')
  })

  it('falls through to the sign-in form on an ordinary auth outcome', async () => {
    mocks.renew.mockRejectedValue(Object.assign(new Error('none'), { code: 'ERR_UNAUTHENTICATED' }))
    await render()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('form.byline-sign-in-form')).not.toBeNull()
  })

  // Runs last: `renewSingleFlight` keeps the in-flight promise at module level,
  // and a never-settling renewal would block every later case in this file.
  it('shows a wordless activity indicator while the bootstrap renewal is pending', async () => {
    mocks.renew.mockReturnValue(new Promise(() => {}))
    await render()
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.querySelector('.byline-loader-ring')).not.toBeNull()
    // The only text is the visually hidden label; nothing advertises a session check.
    expect(status?.textContent).toBe('Loading…')
    expect(container.textContent).not.toContain('session')
  })
})
