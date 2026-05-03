'use client'

import type React from 'react'
import { createContext, useCallback, useState } from 'react'

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
          <Dialog.Backdrop className={cx('infonomic-modal-backdrop', styles.backdrop)} />
          <Dialog.Popup className={cx('infonomic-modal-wrapper', styles['modal-wrapper'])}>
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
