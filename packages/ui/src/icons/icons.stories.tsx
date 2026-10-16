import type React from 'react'

import * as AllIcons from './index.js'

const IconsDemo = (): React.JSX.Element => (
  <div
    className="icon-demo"
    style={{
      margin: '16px 0',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
      gap: '12px',
    }}
  >
    {Object.entries(AllIcons)
      .filter(([name, Icon]) => name !== 'IconElement' && typeof Icon === 'function')
      .map(([name, Icon]) => {
        // Cast to any to avoid complex typing for the import * object
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Component = Icon as React.ComponentType<any>
        return (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Component
              style={{ marginBottom: '8px', width: '28px', height: '28px' }}
              width="28px"
              height="28px"
            />
            <div
              style={{
                fontSize: '10px',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
              title={name}
            >
              {name}
            </div>
          </div>
        )
      })}
  </div>
)

export default {
  title: 'Icons/All',
  component: IconsDemo,
  argTypes: {},
}

export const All = (): React.JSX.Element => {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ maxWidth: '700px' }}>
        <IconsDemo />
      </div>
    </div>
  )
}
