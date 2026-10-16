import type React from 'react'

import { DangerIcon } from './danger-icon.js'
import { InfoIcon } from './info-icon.js'
import { SuccessIcon } from './success-icon.js'
import { WarningIcon } from './warning-icon.js'

export default {
  title: 'Icons/Sprites',
  argTypes: {},
}

export const Sprites = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ maxWidth: '800px', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)' }}>
        <InfoIcon />
        <WarningIcon />
        <SuccessIcon />
        <DangerIcon />
      </div>
    </div>
  )
}
