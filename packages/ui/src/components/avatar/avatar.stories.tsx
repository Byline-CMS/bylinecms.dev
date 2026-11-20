import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { Avatar as AvatarComponent } from './avatar.js'

// A local image, so the story makes no network request.
const photo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c9cbf"/><stop offset="1" stop-color="#2f4a6b"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="20" cy="16" r="7" fill="#e8eef5"/><path d="M6 40c2-9 8-13 14-13s12 4 14 13z" fill="#e8eef5"/></svg>'
)}`

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
    <div style={{ height: '40px', width: '40px' }}>
      <AvatarComponent initials="AB" src={photo} alt="Example user" />
    </div>
  </div>
)
