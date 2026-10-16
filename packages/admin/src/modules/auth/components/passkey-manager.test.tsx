import { act, type ReactNode } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ services: {} as any, proof: vi.fn(), enroll: vi.fn() }))
vi.mock('../../../services/admin-services-context.js', () => ({
  useBylineAdminServices: () => ({ passkeys: mocks.services }),
}))
vi.mock('@byline/i18n/react', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      `${key}${values?.name ? ` ${values.name}` : ''}`,
  }),
}))
vi.mock('@byline/core', () => ({ getAdminConfig: () => ({ routes: { signIn: '/sign-in' } }) }))
vi.mock('./passkey-browser.js', () => ({
  provePasskeyAction: mocks.proof,
  enrollPasskey: mocks.enroll,
  passkeyErrorKey: () => 'passkeys.errors.proof',
}))
vi.mock('@byline/ui/react', () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>
  const Modal = Object.assign(
    ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
    { Container: Box, Header: Box, Content: Box, Actions: Box }
  )
  const Drawer = Object.assign(
    ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
    { Container: Box, TopActions: Box, Header: Box, Content: Box }
  )
  return {
    Modal,
    Drawer,
    CloseIcon: () => null,
    IconButton: ({ children, onClick, ...rest }: any) => (
      <button type="button" onClick={onClick} aria-label={rest['aria-label']}>
        {children}
      </button>
    ),
    Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
    Button: ({ children, onClick, disabled, ...rest }: any) => (
      <button type="button" disabled={disabled} onClick={onClick} aria-label={rest['aria-label']}>
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
  }
})

import { PasskeyManager } from './passkey-manager.js'

let root: Root
let container: HTMLDivElement
const key = {
  id: 'record',
  name: 'Security key',
  createdAt: new Date(0).toISOString(),
  lastUsedAt: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.services = {
    capability: vi.fn().mockResolvedValue({ enabled: true }),
    captureLogin: vi.fn(() => ({ expectedSessionId: 'login', assertCurrent: vi.fn() })),
    managementContext: vi
      .fn()
      .mockResolvedValue({ id: 'self', isSuperAdmin: false, canManagePasskeys: false }),
    list: vi.fn().mockResolvedValue([key]),
    rename: vi.fn(),
    remove: vi.fn(),
  }
  mocks.proof.mockResolvedValue({
    grantId: 'grant',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })
  mocks.services.remove.mockResolvedValue({ signedOut: false })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const render = async (targetUserId = 'self', targetIsSuperAdmin = false) => {
  await act(async () =>
    root.render(
      <PasskeyManager targetUserId={targetUserId} targetIsSuperAdmin={targetIsSuperAdmin} />
    )
  )
}
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label
  )
  expect(button).toBeTruthy()
  await act(async () => button!.click())
}
describe('passkey manager controls', () => {
  it('hides the flow when passkeys are disabled', async () => {
    mocks.services.capability.mockResolvedValue({ enabled: false })
    await render()
    expect(container.innerHTML).toBe('')
    expect(mocks.services.list).not.toHaveBeenCalled()
  })
  it('allows self-service enrollment and rename', async () => {
    await render()
    expect(container.textContent).toContain('passkeys.add')
    expect(container.textContent).toContain('passkeys.rename')
    expect(container.textContent).toContain('Security key')
  })
  it('hides recovery without the ability and protects super-admin targets', async () => {
    await render('other')
    expect(container.innerHTML).toBe('')
    expect(mocks.services.list).not.toHaveBeenCalled()
    mocks.services.managementContext.mockResolvedValue({
      id: 'self',
      isSuperAdmin: false,
      canManagePasskeys: true,
    })
    await render('super', true)
    expect(container.innerHTML).toBe('')
  })
  it('offers only removal for an authorized recovery target', async () => {
    mocks.services.managementContext.mockResolvedValue({
      id: 'self',
      isSuperAdmin: false,
      canManagePasskeys: true,
    })
    await render('other')
    expect(container.textContent).toContain('passkeys.remove')
    expect(container.textContent).not.toContain('passkeys.add')
    expect(container.textContent).not.toContain('passkeys.rename')
  })
  it('requires explicit confirmation before requesting proof and allows cancellation', async () => {
    await render()
    await click('passkeys.remove')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'passkeys.removeWarning Security key'
    )
    expect(mocks.proof).not.toHaveBeenCalled()
    await click('common.actions.cancel')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.services.remove).not.toHaveBeenCalled()
  })
  it('never removes a key after a failed or wrong-account fresh proof', async () => {
    mocks.proof.mockRejectedValue(new Error('wrong account'))
    await render()
    await click('passkeys.remove')
    await click('passkeys.usePasskey')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('passkeys.errors.proof')
    expect(mocks.services.remove).not.toHaveBeenCalled()
    expect(mocks.proof).toHaveBeenCalledOnce()
  })
  it('shows completion only after confirmed removal and retains the actor view', async () => {
    await render()
    await click('passkeys.remove')
    await click('passkeys.usePasskey')
    expect(mocks.services.remove).toHaveBeenCalledWith({
      data: { expectedSessionId: 'login', grantId: 'grant' },
    })
    expect(container.querySelector('[role="status"]')?.textContent).toBe('passkeys.removed')
    expect(container.textContent).not.toContain('Security key')
  })
})
