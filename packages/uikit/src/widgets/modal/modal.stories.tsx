// biome-ignore lint/style/useImportType: <explanation>
import React from 'react'

import { Button } from '../../components/button/button.js'
import { IconButton } from '../../components/button/icon-button.js'
import { CloseIcon } from '../../icons/close-icon.js'
import { Modal, useModal } from './modal.js'

export default {
  title: 'Widgets/Modal',
  component: Modal,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  const { onDismiss, onOpen, isOpen, setIsOpen } = useModal()

  const whiteIcon = `
    .white-icon {
      fill: white;  
    }
  `

  return (
    <>
      <style>{whiteIcon}</style>
      <Button
        onClick={() => {
          setIsOpen(true)
        }}
      >
        Open Modal
      </Button>
      <Modal isOpen={isOpen} onDismiss={onDismiss} closeOnOverlayClick={true}>
        <Modal.Container style={{ maxWidth: '600px' }}>
          <Modal.Header>
            <h2>Modal Header</h2>
            <IconButton
              arial-label="Close"
              size="sm"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <p style={{ paddingTop: '1rem' }}>
              Modal content with some text here that should run a little longer. And longer here.
              And the current theme is.
            </p>
          </Modal.Content>
          <Modal.Actions>
            <Button
              size="sm"
              intent="noeffect"
              onClick={() => {
                setIsOpen(false)
              }}
              data-autofocus
            >
              Close
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>
    </>
  )
}
