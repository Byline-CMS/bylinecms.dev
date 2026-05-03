/**
 * Focus trap hook — traps keyboard focus within a container element.
 *
 * Based on use-focus-trap from Mantine (https://github.com/mantinedev/mantine)
 * Original work licensed under the MIT License.
 * Copyright (c) 2021 Vitaly Rtishchev
 *
 * Adapted for use as an internal ESM/TypeScript module.
 */

import { useCallback, useEffect, useRef } from 'react'

import { scopeTab } from './scope-tab.js'
import { FOCUS_SELECTOR, focusable, tabbable } from './tabbable.js'

export function useFocusTrap(active = true): React.RefCallback<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null)

  const focusNode = useCallback((node: HTMLElement) => {
    let focusElement: HTMLElement | null = node.querySelector('[data-autofocus]')

    if (!focusElement) {
      const children = Array.from<HTMLElement>(node.querySelectorAll(FOCUS_SELECTOR))
      focusElement = children.find(tabbable) || children.find(focusable) || null
      if (!focusElement && focusable(node)) {
        focusElement = node
      }
    }

    if (focusElement) {
      focusElement.focus({ preventScroll: true })
    }
  }, [])

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      if (!active) {
        return
      }

      if (node === null) {
        return
      }

      if (ref.current === node) {
        return
      }

      if (node) {
        // Delay processing the HTML node by a frame. This ensures focus is assigned correctly.
        setTimeout(() => {
          if (node.getRootNode()) {
            focusNode(node)
          }
        })

        ref.current = node
      } else {
        ref.current = null
      }
    },
    [active, focusNode]
  )

  useEffect(() => {
    if (!active) {
      return undefined
    }

    ref.current && setTimeout(() => focusNode(ref.current!))

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && ref.current) {
        scopeTab(ref.current, event)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [active, focusNode])

  return setRef
}
