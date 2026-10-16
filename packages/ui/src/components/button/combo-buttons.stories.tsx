import type { Meta, StoryObj } from '@storybook/react-vite'

import { ComboButton } from './combo-button.js'

type Story = StoryObj<typeof ComboButton>

const options = [
  { label: 'Item 1', value: 'item1' },
  { label: 'Item 2', value: 'item2' },
  { label: 'Item 3', value: 'item3' },
]

const handleButtonClick = () => {
  alert('Button clicked!')
}

const handleOptionSelect = (value: string) => {
  alert(`Selected option: ${value}`)
}

const ComboButtonDemo = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <div style={{ marginLeft: '3rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.2rem', margin: '1rem 0' }}>Combo Button</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <ComboButton
            size="sm"
            options={options}
            onButtonClick={handleButtonClick}
            onOptionSelect={handleOptionSelect}
          >
            Combo Button
          </ComboButton>
        </div>
      </div>
      <div style={{ marginLeft: '3rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.2rem', margin: '1rem 0' }}>No Options Combo Button</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <ComboButton
            size="sm"
            options={[]}
            onButtonClick={handleButtonClick}
            onOptionSelect={handleOptionSelect}
          >
            Combo Button
          </ComboButton>
        </div>
      </div>

      <div style={{ marginLeft: '3rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.2rem', margin: '1rem 0' }}>Disabled Combo Button</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <ComboButton
            size="sm"
            options={options}
            onButtonClick={handleButtonClick}
            onOptionSelect={handleOptionSelect}
            disabled={true}
          >
            Combo Button
          </ComboButton>
        </div>
      </div>
    </div>
  )
}

export const ComboButtons: Story = {
  render: () => <ComboButtonDemo />,
}

const meta: Meta<typeof ComboButton> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Button',
  component: ComboButtonDemo,
}

export default meta
