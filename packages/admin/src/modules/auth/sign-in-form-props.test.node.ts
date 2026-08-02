import { describe, expectTypeOf, it } from 'vitest'

import type { SignInFormProps } from './components/sign-in-form.js'

describe('SignInFormProps', () => {
  it('accepts redirectTo and no destination prop', () => {
    expectTypeOf<{ redirectTo: string }>().toMatchTypeOf<SignInFormProps>()
    expectTypeOf<Record<string, never>>().toMatchTypeOf<SignInFormProps>()
  })
})
