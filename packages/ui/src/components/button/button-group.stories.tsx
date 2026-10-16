import type React from 'react'
import { useState } from 'react'

import type { Meta, StoryObj } from '@storybook/react-vite'

import { ButtonGroup as ButtonGroupComponent, ButtonGroupItem } from './button-group.js'

const meta: Meta<typeof ButtonGroupComponent> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Button',
  component: ButtonGroupComponent,
}

export default meta

type Story = StoryObj<typeof ButtonGroupComponent>

const ButtonGroupDemo = (): React.JSX.Element => {
  const [value, setValue] = useState<string | string[]>('one')
  const handleOnValueChange = (value: string | string[]) => {
    setValue(value)
  }
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <ButtonGroupComponent
        type="single"
        expandToFit={true}
        value={value as string}
        onValueChange={handleOnValueChange}
      >
        <ButtonGroupItem value="one">One</ButtonGroupItem>
        <ButtonGroupItem value="two">Two</ButtonGroupItem>
        <ButtonGroupItem value="three">Three</ButtonGroupItem>
      </ButtonGroupComponent>
    </div>
  )
}

export const ButtonGroup: Story = {
  render: () => <ButtonGroupDemo />,
}
