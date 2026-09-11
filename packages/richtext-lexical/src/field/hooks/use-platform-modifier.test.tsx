import { act } from 'react'

import { hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The client believes it is on a Mac. The SERVER never does — it has no
// `navigator` — so this mock reproduces the split that caused the
// mismatch: markup rendered without the platform, hydrated with it.
vi.mock('../shared/environment', () => ({ IS_APPLE: true }))

import { IS_APPLE } from '../shared/environment'
import { useIsApplePlatform } from './use-platform-modifier'

// biome-ignore lint/suspicious/noExplicitAny: React act environment flag
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

/** The label a server renders: platform unknown, so the non-Apple form. */
const SERVER_MARKUP = '<button type="button" title="Bold (Ctrl+B)"></button>'

function ViaHook(): React.JSX.Element {
  const isApple = useIsApplePlatform()
  return <button type="button" title={isApple ? 'Bold (⌘B)' : 'Bold (Ctrl+B)'} />
}

/** How the toolbar read the platform before: straight from the constant. */
function ViaConstant(): React.JSX.Element {
  return <button type="button" title={IS_APPLE ? 'Bold (⌘B)' : 'Bold (Ctrl+B)'} />
}

const mounted: Array<{ root: { unmount: () => void }; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
})

async function hydrate(element: React.JSX.Element): Promise<{
  container: HTMLDivElement
  errors: string[]
}> {
  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(String(args[0]))
  })

  const container = document.createElement('div')
  container.innerHTML = SERVER_MARKUP
  document.body.appendChild(container)

  let root: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(container, element)
  })
  // biome-ignore lint/style/noNonNullAssertion: assigned inside act
  mounted.push({ root: root!, container })
  spy.mockRestore()
  return { container, errors }
}

describe('useIsApplePlatform', () => {
  it('hydrates server markup without a mismatch, then adopts the platform', async () => {
    const { container, errors } = await hydrate(<ViaHook />)

    expect(errors.join(' ')).not.toMatch(/did not match|hydrat/i)
    // Adopted after hydration, which is the whole point: the label is
    // right for the reader without the first render disagreeing.
    expect(container.querySelector('button')?.title).toBe('Bold (⌘B)')
  })

  it('CONTROL: reading the constant during render does mismatch', async () => {
    // Pins why the hook exists. React reports this and, as it warns,
    // does not patch the attribute up — leaving a Mac user looking at
    // `Ctrl+B`, and a screen reader announcing it.
    const { errors } = await hydrate(<ViaConstant />)
    expect(errors.join(' ')).toMatch(/did not match|hydrat/i)
  })
})
