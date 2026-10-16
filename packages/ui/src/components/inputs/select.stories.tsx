import type React from 'react'

import { Select, SelectItem, type SelectValue } from './select.js'

export default {
  title: 'Components/Inputs/Select',
  component: Select,
  argTypes: {},
}

const values: SelectValue[] = [
  { label: 'One', value: '1' },
  { label: 'Two', value: '2' },
  { label: 'Three', value: '3' },
  { label: 'Four', value: '4' },
  { label: 'Five', value: '5' },
]

export const Default = (): React.JSX.Element => {
  return (
    <>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <Select
          items={values}
          size="xl"
          placeholder="Select one..."
          helpText="Extra Large select."
        />
      </div>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <Select items={values} size="lg" placeholder="Select one..." helpText="Large select." />
      </div>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <Select items={values} size="md" placeholder="Select one..." helpText="Medium select." />
      </div>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <Select items={values} size="sm" placeholder="Select one..." helpText="Small select." />
      </div>
      <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <Select
          items={values}
          size="xs"
          placeholder="Select one..."
          helpText="Extra small select."
        />
      </div>
    </>
  )
}

export const CustomChildren = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto' }}>
      <Select
        items={values}
        size="md"
        placeholder="Select one..."
        helpText="Custom children rendering."
      >
        {values.map((value) => (
          <SelectItem key={value.value} value={value.value} label={value.label}>
            {value.prefix}
            {value.label}
            {value.suffix}
          </SelectItem>
        ))}
      </Select>
    </div>
  )
}
