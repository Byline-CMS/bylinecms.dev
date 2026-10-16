import type { Meta } from '@storybook/react-vite'

import { RadioGroup as RadioGroupComponent, RadioGroupItem } from './radio-group.js'
import type { RadioGroupValue } from './radio-group.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Inputs/RadioGroup',
  component: RadioGroupComponent,
}

export default meta

const values1: RadioGroupValue[] = [
  { id: 'rg1', label: 'One', value: '1' },
  { id: 'rg2', label: 'Two', value: '2' },
  { id: 'rg3', label: 'Three', value: '3' },
]

const values2: RadioGroupValue[] = [
  { id: 'rg4', label: 'One', value: '1' },
  { id: 'rg5', label: 'Two', value: '2' },
  { id: 'rg6', label: 'Three', value: '3' },
]

const values3: RadioGroupValue[] = [
  { id: 'rg7', label: 'One', value: '1' },
  { id: 'rg8', label: 'Two', value: '2' },
  { id: 'rg9', label: 'Three', value: '3' },
]

export const Default = (): React.JSX.Element => {
  return (
    <>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <RadioGroupComponent direction="row" defaultValue="1">
          {values1.map((value) => (
            <RadioGroupItem key={value.id} value={value.value} id={value.id} label={value.label} />
          ))}
        </RadioGroupComponent>
      </div>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <RadioGroupComponent direction="row" defaultValue="2">
          {values2.map((value) => (
            <RadioGroupItem
              intent="secondary"
              key={value.id}
              value={value.value}
              id={value.id}
              label={value.label}
            />
          ))}
        </RadioGroupComponent>
      </div>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <RadioGroupComponent direction="column" defaultValue="3">
          {values3.map((value) => (
            <RadioGroupItem
              intent="success"
              key={value.id}
              value={value.value}
              id={value.id}
              label={value.label}
            />
          ))}
        </RadioGroupComponent>
      </div>
    </>
  )
}
