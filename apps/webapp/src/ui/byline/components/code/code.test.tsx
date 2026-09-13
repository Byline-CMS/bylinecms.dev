import { act } from 'react'

import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'

import { Code } from './code'

// Keep this hydration regression focused on the serializer rather than the
// UI package's CSS imports and clipboard implementation.
vi.mock('@byline/ui/react', () => ({ CopyButton: () => <button type="button">Copy</button> }))

afterEach(() => {
  document.documentElement.className = ''
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each(['light', 'dark'])(
  'hydrates with a stored %s theme and switches without changing markup',
  async (theme) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRecoverableError = vi.fn()
    const element = (
      <Code code={'// Example\nconst answer = "hello"\n'.repeat(3)} language="typescript" />
    )
    const serverHTML = renderToString(element)
    const container = document.createElement('div')
    container.innerHTML = serverHTML
    const parsedServerHTML = container.innerHTML
    document.body.append(container)

    // Simulate the early detector applying a browser preference before React
    // hydrates the server HTML, which was rendered without that preference.
    localStorage.setItem('theme', theme)
    document.documentElement.className = theme
    let root: ReturnType<typeof hydrateRoot> | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError })
      })
      expect(container.innerHTML).toBe(parsedServerHTML)
      expect(container.querySelector('pre')?.style.color).toBe('var(--code-text)')

      document.documentElement.className = theme === 'dark' ? 'light' : 'dark'
      await act(async () => {
        root?.render(element)
      })
      expect(container.innerHTML).toBe(parsedServerHTML)
      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  }
)
