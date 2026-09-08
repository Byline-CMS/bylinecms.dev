import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  submit: null as
    | null
    | ((args: {
        value: { currentPassword: string; newPassword: string; confirm: string }
      }) => Promise<void>),
}))
vi.mock('@tanstack/react-form-start', () => ({
  revalidateLogic: () => ({}),
  useForm: (options: { onSubmit: typeof mocks.submit }) => {
    mocks.submit = options.onSubmit
    return { reset: vi.fn(), Field: () => null, Subscribe: () => null }
  },
}))
vi.mock('../../../services/admin-services-context.js', () => ({
  useBylineAdminServices: () => ({ changeAccountPassword: mocks.change }),
}))
vi.mock('@byline/i18n/react', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'account.changePassword.feedback.updated': 'Password updated.',
        'auth.signIn.title': 'Sign in',
      })[key] ?? key,
  }),
}))
vi.mock('@byline/ui/react', () => ({
  Alert: ({ children, role }: { children: React.ReactNode; role?: string }) => (
    <div role={role}>{children}</div>
  ),
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  InputPassword: () => null,
  LoaderEllipsis: () => null,
}))

import { ChangeAccountPassword } from './change-password.js'
import type { AccountResponse } from '../index.js'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
it('keeps success confirmation and a sign-in action visible after completion', async () => {
  const account = { id: 'account', vid: 1 } as AccountResponse
  mocks.change.mockResolvedValue({ ...account, vid: 2 })
  await act(async () => root.render(<ChangeAccountPassword account={account} />))
  await act(async () => {
    await mocks.submit?.({ value: { currentPassword: 'old', newPassword: 'new', confirm: 'new' } })
  })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Password updated.')
  expect(container.querySelector('button')?.textContent).toBe('Sign in')
  expect(container.querySelector('form')).toBeNull()
})
