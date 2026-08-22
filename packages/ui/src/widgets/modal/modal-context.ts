'use client'

import { createContext } from 'react'

/**
 * Shared between `Modal` and its slots. Lives in its own module because
 * `Modal` renders `Modal.Header` while `Modal.Header` needs the context —
 * importing it from `modal.tsx` would make the two modules circular.
 */
export const ModalContext = createContext<{
  onDismiss?: () => void
  /**
   * Id the dialog points `aria-labelledby` at. `Modal.Header` puts it on the
   * heading it finds among its children, which is what gives the dialog its
   * accessible name — without it a screen reader announces every modal in the
   * admin as an unnamed "dialog".
   *
   * A dangling reference degrades safely: name computation ignores an
   * `aria-labelledby` that resolves to nothing and falls through, so a modal
   * with no header is no worse off than before.
   */
  headingId?: string
}>({})
