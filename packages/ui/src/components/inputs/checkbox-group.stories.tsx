import type React from 'react'
import { useState } from 'react'

import { CheckboxGroup } from './checkbox-group.js'

export default {
  title: 'Components/Inputs/CheckboxGroup',
  component: CheckboxGroup,
  argTypes: {},
}

export const Default = (): React.JSX.Element => {
  const [checked, setChecked] = useState(false)

  const _handleOnClick = (): void => {
    console.log('clicked')
    setChecked(!checked)
  }

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto 2rem' }}>
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Checkbox Group</h2>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}
      >
        <div style={{ minWidth: 0 }}>
          <CheckboxGroup
            groupName="roles"
            // TODO: Nullability of role.name
            checkBoxes={[
              { id: 'admin', label: 'Admin' },
              { id: 'editor', label: 'Editor' },
              { id: 'viewer', label: 'Viewer' },
            ]}
            // onChange={(selected) => {
            //   handleOnClick(selected)
            // }}
          />
        </div>
      </div>
    </div>
  )
}
