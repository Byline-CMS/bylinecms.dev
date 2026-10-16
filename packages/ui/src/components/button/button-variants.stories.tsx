import type React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { capitalize } from '../../utils/capitalize.js'
import { size } from '../@types/shared.js'
import { variant } from './@types/button.js'
import { Button } from './button.js'

type Story = StoryObj<typeof Button>

const AllVariants = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto' }}>
      {variant.map((variant: any) => {
        return (
          <div
            key={variant}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr)',
              gap: '32px',
              marginBottom: '32px',
              alignItems: 'center',
            }}
          >
            {size.map((size: any) => {
              return (
                <Button key={`${variant}=${size}`} size={size} variant={variant}>
                  {`${capitalize(variant)} ${size.toUpperCase()}`}
                </Button>
              )
            })}
            <Button key={`${variant}=${size}`} disabled variant={variant}>
              {`${capitalize(variant)} Disabled`}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

export const ButtonVariants: Story = {
  render: () => <AllVariants />,
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
