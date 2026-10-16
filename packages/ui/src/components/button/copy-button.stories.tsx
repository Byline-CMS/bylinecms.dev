import type React from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { intent } from '../@types/shared.js'
import { variant } from './@types/button.js'
import { CopyButton as CopyButtonComponent } from './copy-button.js'

type Story = StoryObj<typeof CopyButtonComponent>

const CopyDemo = (): React.JSX.Element => {
  return (
    <div style={{ marginLeft: '12rem', marginTop: '4rem' }}>
      {intent.map((i) => {
        return (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}
          >
            {variant.map((v) => {
              return (
                <CopyButtonComponent
                  text="I should be in your clipboard."
                  key={`${i}-${v}`}
                  intent={i}
                  variant={v}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export const CopyButtons: Story = {
  render: () => <CopyDemo />,
}

const meta: Meta<typeof CopyButtonComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Button',
  component: CopyButtonComponent,
}

export default meta
