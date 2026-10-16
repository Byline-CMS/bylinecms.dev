import type React from 'react'

import type { Meta } from '@storybook/react-vite'

import { UserIcon } from '../../icons/user-icon.js'
import { size } from '../@types/shared.js'
import { variant } from './@types/button.js'
import { IconButton } from './icon-button.js'

const getUserIconSize = (size: string) => {
  switch (size) {
    case 'xs':
      return { width: '16px', height: '16px' }
    case 'sm':
      return { width: '18px', height: '18px' }
    case 'md':
      return { width: '22px', height: '22px' }
    case 'lg':
      return { width: '26px', height: '26px' }
    case 'xl':
      return { width: '30px', height: '30px' }
    default:
      return { width: '28px', height: '28px' }
  }
}

export const IconButtonsRound = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto' }}>
      {variant.map((variant: any) => {
        return (
          <div
            key={variant}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '32px',
              marginBottom: '32px',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {size.map((size: any) => {
              const iconSize = getUserIconSize(size)
              return (
                <div
                  key={`${variant}=${size}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconButton size={size} variant={variant}>
                    <UserIcon width={iconSize.width} height={iconSize.height} />
                  </IconButton>
                </div>
              )
            })}
            <div
              key={`${variant}=${size}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconButton disabled variant={variant}>
                <UserIcon width="22px" height="22px" />
              </IconButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const IconButtonsSquare = (): React.JSX.Element => {
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto' }}>
      {variant.map((variant: any) => {
        return (
          <div
            key={variant}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '32px',
              marginBottom: '32px',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {size.map((size: any) => {
              const iconSize = getUserIconSize(size)
              return (
                <div
                  key={`${variant}=${size}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconButton size={size} square={true} variant={variant}>
                    <UserIcon width={iconSize.width} height={iconSize.height} />
                  </IconButton>
                </div>
              )
            })}
            <div
              key={`${variant}=${size}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconButton disabled square={true} variant={variant}>
                <UserIcon width="22px" height="22px" />
              </IconButton>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const meta: Meta<typeof IconButton> = {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/react/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'Components/Button',
  component: IconButton,
}

export default meta
