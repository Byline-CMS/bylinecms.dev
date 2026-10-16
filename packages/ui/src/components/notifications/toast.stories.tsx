import type React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '../button/button.js'
import { useToastManager } from './toast.js'

function ToastDemo(): React.JSX.Element {
  const toastManager = useToastManager()

  const handleOpenToastClick = (): void => {
    toastManager.add({
      title: 'Note',
      description:
        'This is a test Toast notification that should appear when the button is clicked.',
      data: {
        intent: 'success',
        iconType: 'success',
        icon: true,
        close: true,
      },
    })
  }

  return (
    <div style={{ maxWidth: '600px', margin: '2rem 0' }}>
      <Button onClick={handleOpenToastClick}>Open Toast</Button>
    </div>
  )
}

export const Toast: StoryObj = {
  render: () => <ToastDemo />,
}

const meta: Meta = {
  title: 'Components/Toast',
}

export default meta
