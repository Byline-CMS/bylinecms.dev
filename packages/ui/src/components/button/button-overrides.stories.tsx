import type React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './button.js'

type Story = StoryObj<typeof Button>

const AllOverrides = (): React.JSX.Element => {
  return (
    <>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <div
          style={{
            width: '300px',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--stroke-primary)',
            backgroundColor: 'var(--gray-25)',
          }}
        >
          <Button className="not-dark" variant="filled" size="sm" style={{ marginRight: '1rem' }}>
            Force Light
          </Button>
        </div>
      </div>
      <div className="dark" style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <div
          style={{
            width: '300px',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--stroke-primary)',
            backgroundColor: 'var(--canvas-800)',
          }}
        >
          <Button variant="filled" size="sm" style={{ marginRight: '1rem' }}>
            Force Dark
          </Button>
        </div>
      </div>
    </>
  )
}

export const ButtonOverrides: Story = {
  render: () => <AllOverrides />,
}

const meta: Meta<typeof Button> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Button',
  component: Button,
}

export default meta
