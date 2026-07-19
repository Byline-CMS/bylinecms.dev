'use client'

import type React from 'react'
import { createContext, useCallback, useRef, useState } from 'react'

import { Dialog } from '@base-ui/react/dialog'
import cx from 'classnames'

import styles from './modal.module.css'
import { ModalActions } from './modal-actions'
import { ModalContainer } from './modal-container'
import { ModalContent } from './modal-content'
import { ModalHeader } from './modal-header'

export interface ModalProps {
  isOpen?: boolean
  onDismiss?: () => void
  closeOnOverlayClick?: boolean
  children?: React.ReactNode
}

export const ModalContext = createContext<{
  onDismiss?: () => void
}>({})

export type UseModalProps = ReturnType<typeof useModal>

export function useModal(): {
  onDismiss: () => void
  onOpen: () => void
  isOpen: boolean
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
} {
  const [isOpen, setIsOpen] = useState(false)

  const onDismiss = useCallback(() => {
    setIsOpen(false)
  }, [])

  const onOpen = useCallback(() => {
    setIsOpen(true)
  }, [])

  return {
    onDismiss,
    onOpen,
    isOpen,
    setIsOpen,
  }
}

function Modal({
  isOpen,
  onDismiss,
  closeOnOverlayClick,
  children,
}: ModalProps): React.JSX.Element {
  // Overlay dismissal is handled here rather than by Base UI's outside-press
  // detection. `Dialog.Popup` below is the full-viewport flex box that centres
  // the dialog, not the dialog box itself, so a click on the empty space around
  // the dialog still lands *inside* the popup — Base UI sees no outside press
  // and `disablePointerDismissal` never comes into play. Comparing the event
  // target against the popup identifies those clicks: they hit the centring box
  // directly, whereas a click on the dialog hits `Modal.Container` or a
  // descendant of it.
  //
  // The press must both start and end on the popup. Without the pointerdown
  // check, selecting text in the dialog and releasing outside it emits a click
  // on their common ancestor — the popup — and would dismiss the dialog
  // mid-drag.
  const pressStartedOnOverlay = useRef(false)

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    pressStartedOnOverlay.current = event.target === event.currentTarget
  }

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const startedOnOverlay = pressStartedOnOverlay.current
    pressStartedOnOverlay.current = false
    if (closeOnOverlayClick !== true) return
    if (!startedOnOverlay || event.target !== event.currentTarget) return
    onDismiss?.()
  }

  return (
    <ModalContext.Provider value={{ onDismiss }}>
      <Dialog.Root
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            onDismiss?.()
          }
        }}
        modal
        disablePointerDismissal={closeOnOverlayClick !== true}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={cx('byline-modal-backdrop', styles.backdrop)} />
          <Dialog.Popup
            className={cx('byline-modal-wrapper', styles['modal-wrapper'])}
            onPointerDown={handleOverlayPointerDown}
            onClick={handleOverlayClick}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </ModalContext.Provider>
  )
}

Modal.displayName = 'Modal'

Modal.Container = ModalContainer
Modal.Header = ModalHeader
Modal.Content = ModalContent
Modal.Actions = ModalActions

export { Modal }
