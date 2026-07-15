import { describe, expectTypeOf, it } from 'vitest'

import type { SignInFormProps } from './components/sign-in-form.js'

describe('SignInFormProps', () => {
  it('keeps legacy callbackUrl-only callers type-compatible', () => {
    expectTypeOf<{ callbackUrl: string }>().toMatchTypeOf<SignInFormProps>()
  })

  it('accepts the preferred redirectTo prop and no destination prop', () => {
    expectTypeOf<{ redirectTo: string }>().toMatchTypeOf<SignInFormProps>()
    expectTypeOf<Record<string, never>>().toMatchTypeOf<SignInFormProps>()
  })
})
