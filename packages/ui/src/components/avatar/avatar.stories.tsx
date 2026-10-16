import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { Avatar as AvatarComponent } from './avatar.js'

const meta: Meta = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components',
  component: AvatarComponent,
}

export default meta

export const Avatar = (): React.JSX.Element => (
  <div
    style={{
      maxWidth: '300px',
      margin: '2rem auto',
      display: 'flex',
      gap: '24px',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div style={{ height: '28px', width: '28px' }}>
      <AvatarComponent initials="AB" />
    </div>
    <div style={{ height: '34px', width: '34px' }}>
      <AvatarComponent initials="AB" />
    </div>
    <div style={{ height: '40px', width: '40px' }}>
      <AvatarComponent initials="AB" />
    </div>
  </div>
)
