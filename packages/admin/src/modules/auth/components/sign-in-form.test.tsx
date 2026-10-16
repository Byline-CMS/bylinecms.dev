import { act, type ReactNode } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: true,
  signIn: vi.fn(),
  passkey: vi.fn(),
  services: {} as any,
}))
vi.mock('../../../services/admin-services-context.js', () => ({
  useBylineAdminServices: () => mocks.services,
}))
vi.mock('@byline/i18n/react', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@byline/core', () => ({ getAdminConfig: () => ({ routes: { admin: '/admin' } }) }))
vi.mock('./passkey-browser.js', () => ({
  signInWithPasskey: mocks.passkey,
  passkeyErrorKey: () => 'passkeys.errors.cancelled',
}))
vi.mock('@byline/ui/react', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Card: Object.assign(Box, {
      Header: Box,
      Title: Box,
      Description: Box,
      Content: Box,
      Footer: Box,
    }),
    Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
    Button: ({ children, disabled, onClick, type }: any) => (
      <button type={type} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Input: ({ label, ...rest }: any) => <input aria-label={label} {...rest} />,
    InputPassword: ({
      label,
      showPasswordLabel: _show,
      hidePasswordLabel: _hide,
      ...rest
    }: any) => <input type="password" aria-label={label} {...rest} />,
    LoaderEllipsis: () => null,
    PasskeyIcon: () => null,
  }
})

import { SignInForm } from './sign-in-form.js'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.services = {
    adminSignIn: mocks.signIn,
    passkeys: { capability: async () => ({ enabled: mocks.enabled }) },
  }
  mocks.enabled = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('retains password sign-in when passkeys are disabled or the host has no passkey services', async () => {
  mocks.enabled = false
  await act(async () => root.render(<SignInForm />))
  expect(container.querySelector('input[type="password"]')).not.toBeNull()
  expect(container.textContent).not.toContain('passkeys.signIn')
  delete mocks.services.passkeys
  await act(async () => root.render(<SignInForm />))
  expect(container.querySelector('form')).not.toBeNull()
})
it('keeps password choice visible and restores controls after passkey cancellation', async () => {
  mocks.passkey.mockRejectedValue(new Error('cancelled'))
  await act(async () => root.render(<SignInForm />))
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'passkeys.signIn'
  )!
  expect(button).toBeTruthy()
  expect(container.querySelector('input[type="password"]')).not.toBeNull()
  await act(async () => button.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('passkeys.errors.cancelled')
  expect(button.disabled).toBe(false)
  expect(mocks.passkey).toHaveBeenCalledOnce()
  expect(mocks.signIn).not.toHaveBeenCalled()
})
